"use strict"
let Matsui = (() => {
	let isObject = data => (data && typeof data === 'object');

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
						return;
					}
					value[key] = merge.apply(value[key], childMerge, keepNulls);
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
					let value = Reflect.get(...arguments);
					if (!isObject(value)) return value;
					return merge.tracked(
						value,
						mergeObj => updateFn({
							[prop]: mergeObj
						})
					);
				},
				set(obj, prop, value, proxy) {
					if (value == null) return Reflect.deleteProperty(proxy, prop);
					let oldValue = Reflect.get(obj, prop);
					if (Reflect.set(obj, prop, value)) {
						updateFn({
							[prop]: merge.make(oldValue, value)
						});
						return true;
					}
					return false;
				},
				deleteProperty(obj, prop) {
					if (Reflect.deleteProperty(obj, prop)) {
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
					let value = Reflect.get(...arguments);
					let hasChange = isObject(mergeObj) && (prop in mergeObj);
					return merge.addHidden(value, hasChange ? mergeObj[prop] : noChangeSymbol);
				},
				has(obj, prop) {
					return (prop == hiddenMergeKey) || Reflect.has(obj, prop);
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

	let trackerSetKey = Symbol(), pierceKey = Symbol();
	let addTrackerValue = (trackerObj, trackerValue) => {
		if (!trackerObj[trackerSetKey]) trackerObj[trackerSetKey] = new Set();
		trackerObj[trackerSetKey].add(trackerValue);
	}
	let access = {
		tracked(data, trackerObj, trackerValue) {
			if (!isObject(data)) {
				addTrackerValue(trackerObj, trackerValue);
				return data;
			}
			let isArray = Array.isArray(data);
			let proxy = new Proxy(data, {
				get(obj, prop) {
					let value = Reflect.get(...arguments);
					if (prop == pierceKey) {
						addTrackerValue(trackerObj, trackerValue);
						return data;
					} else if (isArray && prop === 'length') {
						addTrackerValue(trackerObj, trackerValue);
						return value;
					}
					
					if (!(prop in trackerObj)) trackerObj[prop] = {};
					return access.tracked(value, trackerObj[prop], trackerValue);
				},
				ownKeys(obj) { // We're being asked to list our keys - assume this means they're interested in the whole object (including key addition and deletion)
					addTrackerValue(trackerObj, trackerValue);
					return Reflect.ownKeys(obj);
				}
			});
			return proxy;
		},
		pierce(tracked) {
			return (tracked && tracked[pierceKey]) || tracked;
		},
		trackedValues(trackerObj) {
			return trackerObj[trackerSetKey];
		}
	};
	
	let combineUpdates = updateFunctions => {
		let updateTriggers = {};
		let firstRun = true;

		return data => {
			data = access.pierce(data);
			
			if (firstRun) { // run everything the first time
				firstRun = false;
				updateFunctions.forEach((fn, index) => {
					let tracked = access.tracked(data, updateTriggers, index);
					fn(tracked);
				});
				return;
			}

			// Collect all the updates (by index) referenced by the merge, removing them as we go
			let updateSet = new Set();
			function addUpdates(merge, triggers) {
				if (merge == noChangeSymbol) return;
				let updates = access.trackedValues(triggers);
				if (updates) {
					updates.forEach(index => updateSet.add(index));
					updates.clear();
				}
				if (!isObject(merge)) return;
				Object.keys(merge).forEach(key => {
					if (Object.hasOwn(triggers, key)) addUpdates(merge[key], triggers[key]);
				});
			}
			let mergeValue = merge.getHidden(data, noChangeSymbol /* re-use it because why not */);
			addUpdates(mergeValue, updateTriggers);

			updateFunctions.forEach((fn, index) => {
				if (updateSet.has(index)) {
					let tracked = access.tracked(data, updateTriggers, index);
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
			if (!outerTemplate) {
				let element = document.getElementById(outerId);
				if (element) outerTemplate = template.fromElement(element);
			}
			if (outerTemplate) {
				let inner = result;
				result = fallback => outerTemplate(_ => inner(fallback));
			}
		}
		return result;
	}
	
	// Arbitrarily-picked vendor-reserved Unicode points
	let placeholderPrefix = '\uF74A', placeholderSuffix = '\uF74B';
	// Shouldn't appear in text other than from here, so just stick an index between them
	let placeholderRegex = /\uF74A[0-9]+\uF74B/ug;
	function templateFromElementPlaceholders(element, placeholderMap) {
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
				node.childNodes.forEach((child, index) => walk(child, nodePath.concat(index)));
			}
			if (node.attributes) {
				for (let attr of node.attributes) {
					if (attr.name[0] === '$') {
						// TODO: register special handlers
						let name = attr.name.substr(1);
						let contents = expandPlaceholders(attr.value);
						if (!contents) continue;

						let getValue = data => {
							return contents.map(entry => {
								if (typeof entry === 'string') return entry;
								return entry.value(data);
							}).join("");
						};
						if (contents.length == 3 && contents[0] == '' && contents[2] == '') {
							getValue = (data, e) => {
								return contents[1].value(data, e);
							};
						}
						setup.push({
							path: nodePath,
							fn: (node, updates, innerTemplate, getData) => {
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
						path: nodePath,
						fn: (node, updates, innerTemplate) => {
							contents.forEach(entry => {
								if (typeof entry === 'string') {
									if (entry) node.before(entry);
								} else {
									let binding = entry.template(innerTemplate);
									node.before(binding.node);
									updates.push(data => {
										let itemData;
										try {
											itemData = entry.value(data); // item is the mapping function
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
				setup.path.forEach(i => subNode = subNode.childNodes[i]);
				return subNode;
			});
			let latestData = null;
			let getData = () => latestData;
			let updates = [];
			setup.forEach((obj, index) => {
				obj.fn(subNodes[index], updates, innerTemplate, getData);
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

	class TemplateSet {
		constructor(parent) {
			this.#parent = parent;

			/* Switches between templates, based on the filtered list */
			this.dynamic = innerTemplate => {
				let node = document.createDocumentFragment();
				let startNode = document.createTextNode("");
				let endNode = document.createTextNode("");
				node.append(startNode, endNode);
				
				let currentTemplate, currentUpdates;
				
				let update = data => {
					let newTemplate = this.getForData(data);
					if (currentTemplate === newTemplate) {
						return currentUpdates.forEach(fn => fn(data));
					}
					// Clear the previous render
					while (startNode.nextSibling && startNode.nextSibling != endNode) {
						startNode.nextSibling.remove();
					}
					currentTemplate = newTemplate;
					
					let binding = currentTemplate(innerTemplate || this.dynamic);
					currentUpdates = binding.updates;
					currentUpdates.forEach(fn => fn(data));
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
			if (name) this.#map[name] = template;
			if (filter) {
				this.#filtered.unshift({
					filter: filter,
					fn: template
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
		getForData(data) {
			for (let i = 0; i < this.#filtered.length; ++i) {
				let entry = this.#filtered[i];
				if (entry.filter(data)) {
					return entry.fn;
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
				}
				placeholderMap[placeholder] = {
					template: templateFromIds(templateSet, prefix.split('$').slice(1)),
					value: value
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
						if (child.tagName === 'TEMPLATE' && name) {
							if (!childSet) childSet = templateSet.extend();
							childSet.addElement(name, child);
						}
					});
					if (childSet) templateSet = childSet;
					node.childNodes.forEach(child => walk(child, templateSet));
				}
				if (node.nodeType === 1) { // element
					if (node.hasAttribute('@raw')) return;
					for (let attr of node.attributes) {
						if (attr.name[0] == '$') {
							attr.value = replaceString(attr.value, templateSet);
						}
					}
				} else if (node.nodeType === 3) { // text
					node.nodeValue = replaceString(node.nodeValue, templateSet);
				}
			}
			walk(element.content || element, this);
			return templateFromElementPlaceholders(element, placeholderMap);
		}
		
		fromTag(strings, ...values) {
			let placeholderMap = {};
			let placeholderIndex = 0;
			
			let replaceString = text => text.replace(/((\$[a-z_-]+)*){([^\{\}]*)\}/ig, (all, prefixes, _, key) => {
				let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
				let value = (data => isObject(data) ? data[key] : null);
				placeholderMap[placeholder] = {
					template: templateFromIds(this, prefixes.split('$').slice(1)),
					value: value
				}
				return placeholder;
			});

			let parts = [replaceString(strings[0])];
			for (let i = 0; i < values.length; ++i) {
				let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
				let entry = {
					template: t => t(t),
					value: values[i]
				};
				// Steal prefixes from the previous string
				parts[parts.length - 1] = parts[parts.length - 1].replace(/(\$[a-z_-]+)*$/, prefixes => {
					entry.template = templateFromIds(this, prefixes.split('$').slice(1));
					return "";
				});
				placeholderMap[placeholder] = entry;
				parts.push(placeholder);
				
				parts.push(replaceString(strings[i + 1]));
			}
			
			let element = document.createElement('template');
			element.innerHTML = parts.join("");
			return templateFromElementPlaceholders(element, placeholderMap, placeholderRegex);
		}
	}

	//------------------------------------------------------------------------
		
	/* Top-level stuff  */

	let globalSet = new TemplateSet();
	globalSet.add("json", innerTemplate => {
		let textNode = document.createTextNode("");
		return {
			node: textNode,
			updates: [data => {
				textNode.nodeValue = JSON.stringify(data);
			}]
		};
	}, data => true);
	globalSet.add("text", innerTemplate => {
		let textNode = document.createTextNode("");
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
		let separators = [document.createTextNode("")];
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
			let sep = document.createTextNode("");
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
						let binding = innerTemplate(innerTemplate);
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
			let mergeObj = newData;
			if (replaceHost) {
				mergeObj = merge.make(data, newData);
			} else {
				updateDisplayWithMerge(null, null); // clears the render down to just a text node
			}
			setData(newData);
			sendUpdate(mergeObj);
		};
		
		function addBinding(host, templateSet, template) {
			if (typeof host === 'string') host = document.querySelector(host);
			if (!host) throw Error("invalid host");
			
			if (typeof templateSet === 'function') {
				template = templateSet;
				templateSet = globalSet;
			}
			if (!templateSet) templateSet = globalSet;
			if (!template) template = globalSet.fromElement(host);

			let bindingInfo = template(templateSet.dynamic);
			let updateDisplay = combineUpdates(bindingInfo.updates);

			// Update the display straight away
			updateDisplay(mergeTracked, data);
			// and update on future data as well
			updateFunctions.push(updateDisplay);
			
			return bindingInfo.node;
		}
		this.addTo = (element, templateOrSet, template) => {
			let node = addBinding(element, templateOrSet, template);
			element.append(node);
			return this;
		}
		this.replace = (element, templateOrSet, template) => {
			let node = addBinding(element, templateOrSet, template);
			if (element !== node) { // it might be filling out existing nodes in-place
				host.replaceWith(node);
			}
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
