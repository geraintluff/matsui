"use strict"
let Matsui = (() => {
	let isObject = data => (data && typeof data === 'object');
	let makePlaceholderNode = () => document.createTextNode("");

	/*--- JSON Patch Merge stuff ---*/

	// Attach a hidden merge to data, which use later to decide what to re-render
	let hiddenMergeKey = Symbol(), hiddenMergePierceKey = Symbol();
	let noChangeSymbol = Symbol('no change');

	let merge = {
		apply(value, mergeValue, keepNulls) {
			// simple types are just overwritten
			if (!isObject(value) || !isObject(mergeValue)) return mergeValue;
			// Arrays overwrite everything
			if (Array.isArray(mergeValue)) return mergeValue;

			// They're both objects: mergey-merge
			Object.keys(mergeValue).forEach(key => {
				let childMerge = mergeValue[key];
				if (Object.hasOwn(value, key)) {
					if (childMerge == null && !keepNulls) {
						delete value[key];
					} else {
						value[key] = merge.apply(value[key], childMerge, keepNulls);
					}
				} else if (childMerge != null) { // deliberately matching both null/undefined
					value[key] = childMerge;
				}
			});
			return value;
		},
		make(fromValue, toValue, canBeUndefined) {
			if (canBeUndefined && fromValue === toValue) return;
			if (!isObject(toValue) || !isObject(fromValue)) return toValue;
			if (Array.isArray(toValue)) return toValue;

			let mergeObj = {};
			Object.keys(toValue).forEach(key => {
				if (Object.hasOwn(fromValue, key)) {
					let subMerge = merge.make(fromValue[key], toValue[key], true);
					if (typeof subMerge !== 'undefined') {
						mergeObj[key] = subMerge;
					}
				} else {
					mergeObj[key] = toValue[key];
				}
			});
			Object.keys(fromValue).forEach(key => {
				if (!Object.hasOwn(toValue, key)) {
					mergeObj[key] = null;
				}
			});
			if (canBeUndefined && Object.keys(mergeObj).length == 0) return;
			return mergeObj;
		},
		tracked(data, updateFn, asyncUpdates) {
			if (!isObject(data)) return data;
			
			if (asyncUpdates) {
				let actualUpdateFn = updateFn;
				let pendingMerge = null, pendingMergeTimeout = null;
				let notifyPendingMerge = () => {
					clearTimeout(pendingMergeTimeout);
					if (pendingMerge != null) {
						actualUpdateFn(pendingMerge);
						pendingMerge = null;
					}
				}
				updateFn = mergeObj => {
					if (pendingMerge) {
						pendingMerge = merge.apply(pendingMerge, mergeObj, true); // keep nulls because they're meaningful
					} else {
						pendingMerge = mergeObj;
						requestAnimationFrame(notifyPendingMerge);
						clearTimeout(pendingMergeTimeout);
						pendingMergeTimeout = setTimeout(notifyPendingMerge, 0);
					}
				};
			}
			
			return new Proxy(data, {
				get(obj, prop) {
					let value = obj[prop];
					if (!isObject(value)) return value;
					return merge.tracked(
						value,
						mergeObj => updateFn({
							[prop]: mergeObj
						})
					);
				},
				set(obj, prop, value, proxy) {
					if (value == null) return (delete proxy[prop]);
					let oldValue = obj[prop];
					if (Reflect.set(obj, prop, value)) {
						updateFn({
							[prop]: merge.make(oldValue, value)
						});
						return true;
					}
					return false;
				},
				deleteProperty(obj, prop) {
					if (delete obj[prop]) {
						updateFn({
							[prop]: null
						});
						return true;
					}
					return false;
				}
			});
		},
		addHidden(data, mergeObj) {
			if (!isObject(data)) return data;
			return new Proxy(data, {
				get(obj, prop) {
					if (prop == hiddenMergeKey) return mergeObj;
					if (prop == hiddenMergePierceKey) return obj;
					let value = obj[prop];
					let hasChange = isObject(mergeObj) && (prop in mergeObj);
					return merge.addHidden(value, hasChange ? mergeObj[prop] : noChangeSymbol);
				},
				has(obj, prop) {
					return (prop == hiddenMergeKey) || (prop in obj);
				}
			});
		},
		getHidden(data, noChange) {
			if (!isObject(data)) return data;
			let mergeObj = data[hiddenMergeKey];
			if (typeof mergeObj == 'undefined') return data;
			if (mergeObj === noChangeSymbol) return noChange;
			return mergeObj;
		},
		withoutHidden(data) {
			if (!isObject(data)) return data;
			return data[hiddenMergePierceKey] || data;
		}
	};

	/*--- Access-tracking ---*/

	let pierceKey = Symbol();
	let accessedKey = Symbol("accessed");
	let access = {
		tracked(data, trackerObj) {
			if (!isObject(data)) {
				trackerObj[accessedKey] = accessedKey;
				return data;
			}
			let isArray = Array.isArray(data);
			let proxy = new Proxy(data, {
				get(obj, prop) {
					let value = obj[prop];
					if (prop == pierceKey) {
						trackerObj[accessedKey] = accessedKey;
						return data;
					} else if (isArray && prop === 'length') {
						trackerObj[accessedKey] = accessedKey;
						return value;
					}
					
					if (!(prop in trackerObj)) trackerObj[prop] = {};
					return access.tracked(value, trackerObj[prop]);
				},
				ownKeys(obj) { // We're being asked to list our keys - assume this means they're interested in the whole object (including key addition and deletion)
					trackerObj[accessedKey] = accessedKey;
					return Reflect.ownKeys(obj);
				}
			});
			return proxy;
		},
		pierce(tracked) {
			return (tracked && tracked[pierceKey]) || tracked;
		},
		accessed: accessedKey
	};

	/*--- Rendering stuff ---*/

	let combineUpdates = updateFunctions => {
		let firstRun = true;
		
		let updateAccess = [];

		return data => {
			data = access.pierce(data);
			
			if (firstRun) { // run everything the first time
				firstRun = false;
				updateFunctions.forEach((fn, index) => {
					let trackerObj = updateAccess[index] = {};
					let tracked = access.tracked(data, trackerObj);
					fn(tracked);
				});
				return;
			}
			
			function didAccess(trackerObj, mergeValue) {
				if (mergeValue == noChangeSymbol) return false;
				if (trackerObj[accessedKey]) return true;
				if (!isObject(mergeValue)) return false;
				return Object.keys(mergeValue).some(key => {
					return trackerObj[key]
						&& didAccess(trackerObj[key], mergeValue[key]);
				});
			}
			let mergeValue = merge.getHidden(data, noChangeSymbol /* re-use it because why not */);

			updateFunctions.forEach((fn, index) => {
				if (didAccess(updateAccess[index], mergeValue)) {
					let trackerObj = updateAccess[index] = {};
					let tracked = access.tracked(data, trackerObj, index);
					fn(tracked);
				}
			});
		};
	}
	/*--- Pre-supplied templates and template-construction methods ---*/
	
	function templateFromIds(templateSet, ids) {
		let result = (t => t(t)); // Functional programming, babeeeyy
		while (ids.length) {
			let outerId = ids.pop();
			let outerTemplate = templateSet.getNamed(outerId);
			let inner = result;
			result = fallback => outerTemplate(_ => inner(fallback));
		}
		return result;
	}
	
	// Arbitrarily-picked vendor-reserved Unicode points
	let placeholderPrefix = '\uF74A', placeholderSuffix = '\uF74B';
	// Shouldn't appear in text other than from here, so just stick an index between them
	let placeholderRegex = /\uF74A[0-9]+\uF74B/ug;
	function templateFromElementPlaceholders(element, placeholderMap, templateSet) {
		let cloneable = element.content || element;
		let setup = [];
		let cacheLatestData = false;
		
		let expandPlaceholders = string => {
			let contents = [];
			let prevIndex = placeholderRegex.lastIndex = 0;
			for (let match; match = placeholderRegex.exec(string);) {
				// Add the string prefix/separator
				contents.push(string.substr(prevIndex, match.index - prevIndex));
				prevIndex = placeholderRegex.lastIndex;
				
				// Look the value up in the placeholder map
				let entry = placeholderMap[match[0]];
				contents.push(entry);
			}
			if (contents.length) {
				contents.push(string.substr(prevIndex));
				return contents;
			}
		};

		function walk(node, nodePath) {
			if (node.childNodes) {
				node.childNodes.forEach((child, index) => {
					if (child.tagName === 'TEMPLATE') {
						let childTemplate = templateFromElementPlaceholders(child.content, placeholderMap, templateSet);

						for (let attr of child.attributes) {
							if (attr.name[0] === '@') {
								let contents = expandPlaceholders(attr.value) || [attr.value];
							
								let getValue = (data, ...args) => {
									return contents.map(entry => {
										if (typeof entry === 'string') return entry;
										return entry.m_value(data, ...args);
									}).join("");
								};
								if (contents.length == 3 && contents[0] == '' && contents[2] == '') {
									getValue = (data, e) => {
										return contents[1].m_value(data, e);
									};
								}
								
								let directive = templateSet.directives[attr.name.substr(1)];
								if (typeof directive !== 'function') throw Error("Unknown directive: " + attr.name);
								childTemplate = directive(childTemplate, getValue, templateSet);
							}
						}

						if (childTemplate) {
							setup.push({
								m_path: nodePath.concat(index),
								m_fn: (node, updates, innerTemplate, getData) => {
									let binding = childTemplate(innerTemplate);
									node.replaceWith(binding.node);
									updates.push(combineUpdates(binding.updates));
								}
							});
						}
					} else {
						walk(child, nodePath.concat(index));
					}
				});
			}
			if (node.attributes) {
				for (let attr of node.attributes) {
					if (attr.name[0] === '$') {
						// TODO: register special handlers
						let name = attr.name.substr(1);
						let contents = expandPlaceholders(attr.value) || [attr.value];

						let getValue = (data, ...args) => {
							return contents.map(entry => {
								if (typeof entry === 'string') return entry;
								return entry.m_value(data, ...args);
							}).join("");
						};
						if (contents.length == 3 && contents[0] == '' && contents[2] == '') {
							getValue = (data, e) => {
								return contents[1].m_value(data, e);
							};
						}
						setup.push({
							m_path: nodePath,
							m_fn: (node, updates, innerTemplate, getData) => {
								if (name in templateSet.attributes) {
									cacheLatestData = true; // can't be sure we don't need it
									let valueFn = (...args) => {
										return getValue(getData(), ...args);
									};
									let update = templateSet.attributes[name].call(node, node, valueFn);
									if (typeof update === 'function') {
										updates.push(update);
									}
									return;
								}
							
								if (('on' + name) in node) {
									cacheLatestData = true;
									node.addEventListener(name, e => {
										getValue(getData(), e);
									});
								} else {
									updates.push(data => {
										let value = getValue(data);
										if (name in node) {
											if (node[name] !== value) {
												node[name] = value;
											}
										} else {
											node.setAttribute(name, value);
										}
									});
								}
							}
						});
					}
				}
			}
			if (node.nodeType == 3) { // text
				let contents = expandPlaceholders(node.nodeValue);
				if (contents) {
					setup.push({
						m_path: nodePath,
						m_fn: (node, updates, innerTemplate) => {
							contents.forEach(entry => {
								if (typeof entry === 'string') {
									if (entry) node.before(entry);
								} else {
									let binding = entry.m_template(innerTemplate);
									node.before(binding.node);
									updates.push(data => {
										let itemData;
										try {
											itemData = entry.m_value(data); // item is the mapping function
										} catch (e) {
											itemData = e.message;
										}
										binding.updates.forEach(fn => fn(itemData));
									});
								}
							});
							node.remove();
						}
					});
				}
			}
		}
		walk(cloneable, []);

		return innerTemplate => {
			let node = cloneable; // Use the original (and storing a clone) means it works for in-place templates as well
			cloneable = cloneable.cloneNode(true);
			
			// find all the nodes first, before we mess with anything
			let subNodes = setup.map(setup => {
				let subNode = node;
				setup.m_path.forEach(i => subNode = subNode.childNodes[i]);
				return subNode;
			});
			let latestData = null;
			let getData = () => latestData;
			let updates = [];
			setup.forEach((obj, index) => {
				obj.m_fn(subNodes[index], updates, innerTemplate, getData);
			});
			if (cacheLatestData) {
				updates.unshift(data => {
					latestData = merge.withoutHidden(access.pierce(data));
				});
			}
			
			return {
				node: node,
				updates: updates
			};
		};
	}

	let templateCache = Symbol();
	class TemplateSet {
		attributes = {};
		directives = {};
	
		constructor(parent) {
			this.#parent = parent;
			if (parent) {
				this.attributes = Object.create(parent.attributes);
				this.directives = Object.create(parent.directives);
			}

			/* Switches between templates, based on the filtered list */
			this.dynamic = innerTemplate => {
				let node = document.createDocumentFragment();
				let startNode = makePlaceholderNode();
				let endNode = makePlaceholderNode();
				node.append(startNode, endNode);
				
				let currentTemplate, currentUpdates;
				let currentFilterObj = {};
				
				let update = data => {
					if (currentTemplate && currentFilterObj.filter(data)) {
						return currentUpdates(data);
					}
					// Clear the previous render
					while (startNode.nextSibling && startNode.nextSibling != endNode) {
						startNode.nextSibling.remove();
					}

					currentTemplate = this.getForData(data, currentFilterObj);
					let binding = currentTemplate(innerTemplate || this.dynamic);
					currentUpdates = combineUpdates(binding.updates);
					currentUpdates(data);
					startNode.after(binding.node);
				};

				return {node: node, updates: [update]};
			}
		}
		
		#parent;
		#map = {};
		#filtered = [];
		
		extend() {
			return new TemplateSet(this);
		}
		
		add(name, template, filter) {
			if (typeof template !== 'function' && template) {
				template = template.dynamic;
			}
			if (typeof template !== 'function') throw Error('Template not a function');
			if (name) this.#map[name] = template;
			if (filter) {
				this.#filtered.unshift({
					m_filter: filter,
					m_fn: template
				})
			}
			return this;
		}
		addElement(name, element, filter) {
			return this.add(name, this.fromElement(element), filter);
		}
		addAll(list) {
			if (!list) list = 'template';
			if (typeof list === 'string') list = document.querySelectorAll(list);
			list.forEach(child => {
				let name = child.id || child.getAttribute('name');
				if (child.tagName === 'TEMPLATE' && name) {
					this.addElement(name, child);
				}
			});
			return this;
		}
		addTag(name, filter) {
			return (strings, ...values) => {
				let template = this.fromTag(strings, ...values);
				this.add(name, template, filter);
			};
		}

		getNamed(name) {
			if (this.#map[name]) return this.#map[name];
			if (this.#parent) return this.#parent.getNamed(name);
			console.error("Unknown template:", name);
			return this.dynamic;
		}
		getForData(data, extraResults) {
			for (let i = 0; i < this.#filtered.length; ++i) {
				let entry = this.#filtered[i];
				if (entry.m_filter(data)) {
					if (extraResults) extraResults.filter = entry.m_filter;
					return entry.m_fn;
				}
			}
			if (this.#parent) return this.#parent.getForData(data);
			throw Error("No template for data");
		}
		
		fromElement(element) {
			if (typeof element === 'string') {
				let el = document.querySelector(element);
				if (!el) throw Error("Invalid element:" + element);
				element = el;
			}
			if (element[templateCache]) return element[templateCache];
			
			let placeholderMap = {};
			let placeholderIndex = 0;

			let replaceString = (text, templateSet) => text.replace(/((\$[a-z_-]+)*)(\$?)\{([^\{\}]*)\}/ig, (all, prefix, _, $, match) => {
				let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
				let value = (data => isObject(data) ? data[match] : null);
				if ($) {
					// This doesn't work with CSP enabled, and could be confusing to debug either way, so to be helpful we attempt to catch it here
					try {
						value = Function('return (' + match + ')')();
						if (typeof value !== 'function') {
							console.error("Should be a function:", value);
							value = '{' + JSON.stringify(value) + '}';
						}
					} catch (e) {
						console.error(e, match);
						return `{${e.message}}`;
					}
				} else if (match == '=') {
					value = (data => data);
				} else if (!$ && /\s/.test(match)) {
					return all;
				}
				placeholderMap[placeholder] = {
					m_template: templateFromIds(templateSet, prefix.split('$').slice(1)),
					m_value: value
				};
				return placeholder;
			});
			
			function walk(node, templateSet) {
				if (node.childNodes) {
					let childSet = null;
					// scan for sub-templates
					node.childNodes.forEach(child => {
						if (child.nodeType !== 1) return;
						let name = child.id || child.getAttribute('name');
						if (child.tagName === 'TEMPLATE') {
							for (let attr of child.attributes) {
								if (attr.name[0] === '@') {
									attr.value = replaceString(attr.value, templateSet);
								}
							}
							if (name) {
								if (!childSet) childSet = templateSet.extend();
								childSet.add(name, innerTmpl => {
									// it will be cached on the child element
									return templateSet.fromElement(child)(innerTmpl);
								});
							}
							walk(child.content, templateSet);
						}
					});
					if (childSet) templateSet = childSet;
				}
				if (node.nodeType === 1) { // element
					for (let attr of node.attributes) {
						if (attr.name[0] == '$') {
							attr.value = replaceString(attr.value, templateSet);
						}
					}
				} else if (node.nodeType === 3) { // text
					node.nodeValue = replaceString(node.nodeValue, templateSet);
				}
				if (node.childNodes) {
					node.childNodes.forEach(child => walk(child, templateSet));
				}
			}
			walk(element.content || element, this);
			return element[templateCache] = templateFromElementPlaceholders(element, placeholderMap, this);
		}
		
		fromTag(strings, ...values) {
			let placeholderMap = {};
			let placeholderIndex = 0;
			
			let replaceString = text => text.replace(/((\$[a-z_-]+)*){([^\{\}]*)\}/ig, (all, prefixes, _, key) => {
				let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
				let value = (data => isObject(data) ? data[key] : null);
				if (key === '=') {
					value = (data => data);
				}
				if (/\s/.test(key)) {
					return all;
				}
				placeholderMap[placeholder] = {
					m_template: templateFromIds(this, prefixes.split('$').slice(1)),
					m_value: value
				}
				return placeholder;
			});

			let parts = [replaceString(strings[0])];
			for (let i = 0; i < values.length; ++i) {
				let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
				let entry = {
					m_template: t => t(t),
					m_value: values[i]
				};
				// Steal prefixes from the previous string
				parts[parts.length - 1] = parts[parts.length - 1].replace(/(\$[a-z_-]+)*$/, prefixes => {
					entry.m_template = templateFromIds(this, prefixes.split('$').slice(1));
					return "";
				});
				placeholderMap[placeholder] = entry;
				parts.push(placeholder);
				
				parts.push(replaceString(strings[i + 1]));
			}
			
			let element = document.createElement('template');
			element.innerHTML = parts.join("");
			return templateFromElementPlaceholders(element, placeholderMap, this);
		}
	}

	//------------------------------------------------------------------------
		
	/* Top-level stuff  */

	let globalSet = new TemplateSet();
	globalSet.add("json", innerTemplate => {
		let textNode = makePlaceholderNode();
		return {
			node: textNode,
			updates: [data => {
				textNode.nodeValue = JSON.stringify(data);
			}]
		};
	}, data => true);
	globalSet.add("text", innerTemplate => {
		let textNode = makePlaceholderNode();
		return {
			node: textNode,
			updates: [data => {
//				if (isObject(data)) data = JSON.stringify(data);
				textNode.nodeValue = (data == null) ? "" : data;
			}]
		};
	}, data => !isObject(data));
	globalSet.add("list", innerTemplate => {
		let fragment = document.createDocumentFragment();
		let separators = [makePlaceholderNode()];
		fragment.appendChild(separators[0]);
		let updateList, updateObj;

		let pop = () => {
			let before = separators[separators.length - 2];
			let after = separators.pop();
			while (before.nextSibling && before.nextSibling != after) {
				before.nextSibling.remove();
			}
			after.remove();
		}
		let clear = () => {
			while (separators.length > 1) pop();
			updateList = null;
			updateObj = null;
		};
		let addSeparator = () => {
			let sep = makePlaceholderNode();
			separators[separators.length - 1].after(sep);
			separators.push(sep);
			return sep;
		};
		
		return {
			node: fragment,
			updates: [data => {
				data = access.pierce(data); // stop access-tracking here, so individual keys/items don't end up in the access-tracking map.  We're happy to be called more often because we use the hidden merge to do partial updates anyway
				let mergeValue = merge.getHidden(data, noChangeSymbol);
				
				if (Array.isArray(data)) {
					if (!updateList) {
						clear();
						updateList = [];
					}
					if (!mergeValue || mergeValue == noChangeSymbol) return;
					
					// remove old entries
					while (updateList.length > data.length) {
						pop();
						updateList.pop();
					}
					// add new entries
					while (updateList.length < data.length) {
						let endSep = addSeparator();
						let binding = innerTemplate(globalSet.getNamed("json"));
						endSep.before(binding.node);
						updateList.push(combineUpdates(binding.updates));
					}
					// update everything
					updateList.forEach((update, index) => {
						if (index in mergeValue) update(data[index]);
					});
				} else if (isObject(data)) {
					throw Error("not implemented yet");
				} else {
					clear();
				}
			}]
		};
	});
	globalSet.directives.foreach = (template, dataFn, templateSet) => {
		let list = templateSet.getNamed('list');
		if (dataFn == '') dataFn = (x => x);
		if (typeof dataFn != 'function') throw Error("@foreach needs a data-function argument");
		return innerTemplate => {
			let binding = list(_ => template(innerTemplate));
			return {
				node: binding.node,
				updates: [data => {
					let subData = dataFn(data);
					binding.updates.forEach(fn => fn(subData));
				}]
			};
		};
	};
	
	function TrackedRender(data, synchronous) {
		let mergeTracked;
		let updateFunctions = [];
		let sendUpdate = mergeObj => {
			let withMerge = merge.addHidden(mergeTracked, mergeObj);
			updateFunctions.forEach(fn => fn(withMerge));
		};
		// Register for merge updates
		this.track = fn => {
			updateFunctions.push(fn);
			return this;
		};

		let setData = newData => {
			data = newData;
			mergeTracked = merge.tracked(data, sendUpdate, !synchronous);
		};
		setData(data);
		this.data = () => {
			return mergeTracked;
		};
		// Make changes to the data
		this.merge = mergeObj => {
			let newData = merge.apply(data, mergeObj);
			if (newData !== data) setData(newData);
			sendUpdate(mergeObj);
		};
		this.replace = newData => {
			let mergeObj = merge.make(data, newData);
			setData(newData);
			sendUpdate(mergeObj);
		};
		
		function addBinding(host, templateOrSet, template, replace) {
			if (typeof host === 'string') host = document.querySelector(host);
			if (!host) throw Error("invalid host");
			
			if (typeof templateOrSet === 'string') {
				templateOrSet = document.querySelector(templateOrSet);
				if (templateOrSet) templateOrSet = globalSet.fromElement(templateOrSet);
			}
			let templateSet = templateOrSet || globalSet;
			if (typeof templateOrSet === 'function') {
				template = templateSet;
				templateSet = globalSet;
			}
			if (!template) template = templateSet.fromElement(host);

			let bindingInfo = template(templateSet.dynamic);
			let updateDisplay = combineUpdates(bindingInfo.updates);

			// Update the display straight away
			updateDisplay(mergeTracked, data);
			// and update on future data as well
			updateFunctions.push(updateDisplay);
			
			let node = bindingInfo.node;
			if (replace) {
				if (host !== node) { // it might be filling out existing nodes in-place
					host.replaceWith(node);
				}
			} else {
				host.append(node);
			}
		}
		this.addTo = (element, templateOrSet, template) => {
			addBinding(element, templateOrSet, template, false);
			return this;
		}
		this.replace = (element, templateOrSet, template) => {
			addBinding(element, templateOrSet, template, true);
			return this;
		}
	}
	

	let api = {
		merge: merge,
		access: access,
		combineUpdates: combineUpdates,

		global: globalSet,
		wrap: data => new TrackedRender(data),
		addTo: (element, data, template) => {
			return api.wrap(data).addTo(element, template);
		},
		replace: (element, data, template) => {
			return api.wrap(data).replace(element, template);
		}
	}
	return api;
})();
