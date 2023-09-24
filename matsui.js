"use strict"
let Matsui = (() => {
	let isObject = data => (data && typeof data === 'object');
	let makePlaceholderNode = () => document.createTextNode("");
	function clearBetween(before, after) {
		while (before.nextSibling && before.nextSibling != after) {
			before.nextSibling.remove();
		}
	}
	function makeClearable() {
		let node = document.createDocumentFragment();
		let before = makePlaceholderNode();
		let after = makePlaceholderNode();
		node.append(before, after);
		return {
			m_node: node,
			m_replace: (...nodes) => {
				clearBetween(before, after);
				before.after(...nodes);
			}
		}
	}

	/*--- JSON Patch Merge stuff ---*/

	// Attach a hidden merge to data, which use later to decide what to re-render
	let rawKey = Symbol();
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
						let merge = pendingMerge;
						pendingMerge = null; // clear it first
						actualUpdateFn(merge);
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
					if (prop == rawKey) return obj;
					// TODO: if it's a function without a .prototype (meaning it might be bound - see below) is there a way to let it run, but check for changes?  Or return a proxy function to do that when it's called (which could be later)?
					// That could also check for `this` being the proxy, and (before triggering) call the actual function on `obj` instead, which would handle methods which complain when called on the proxy (like Date::toString())
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
					value = getRaw(value);
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
					if (prop == hiddenMergePierceKey || prop == rawKey) return obj;
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
	
	function getRaw(value) {
		if (!isObject(value)) return value;
		let raw = value[rawKey];
		while (raw && raw != value) {
			value = raw;
			raw = value[rawKey];
		}
		return value;
	}

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
					if (prop == rawKey) return obj;
					if (prop == pierceKey) {
						trackerObj[accessedKey] = accessedKey;
						return data;
					} else if (isArray && prop === 'length') {
						trackerObj[accessedKey] = accessedKey;
						return value;
					} else if (typeof value === 'function' && !value.prototype) {
						trackerObj[accessedKey] = accessedKey; // arrow functions, bound functions, and some native methods - more likely to not go through 'this' if they access stuff
						// TODO: now we've done that, should we return a bound version?
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

	let isCombinedKey = Symbol();
	let combineUpdates = updateFunctions => {
		if (updateFunctions.length === 1 && updateFunctions[0][isCombinedKey]) {
			// Already a list with just a single combined function
			return updateFunctions[0];
		}
		Object.freeze(updateFunctions);
		let firstRun = true;
		
		let updateAccess = [];

		let prevData = null;
		let result = data => {
			data = access.pierce(data);
			
			let withoutMerge = merge.withoutHidden(data); // strip the merge info, which should force a full render
			let rawData = getRaw(withoutMerge); // strip all proxies to try and get a uniquely identifiable object
			if (firstRun || prevData !== rawData) { // run everything the first time
				prevData = isObject(rawData) ? rawData : null;
				firstRun = false;
				updateFunctions.forEach((fn, index) => {
					let trackerObj = updateAccess[index] = {};
					let tracked = access.tracked(withoutMerge, trackerObj);
					fn(tracked);
				});
				return;
			}
			
			function didAccess(trackerObj, mergeValue) {
				if (mergeValue == noChangeSymbol) return false;
				if (trackerObj[accessedKey]) return true;
				if (!isObject(mergeValue) || Array.isArray(mergeValue)) return true;
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
		result[isCombinedKey] = isCombinedKey;
		return result;
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
			let prevIndex = 0; // the .lastIndex is already reset to 0 when .exec() returns null
			for (let match; match = placeholderRegex.exec(string);) {
				// Add the string prefix/separator
				let prefix = string.substr(prevIndex, match.index - prevIndex)
				if (prefix) contents.push(prefix);
				prevIndex = placeholderRegex.lastIndex;
				// Add the value from the placeholder map
				contents.push(placeholderMap[match[0]]);
			}
			if (contents.length) {
				let suffix = string.substr(prevIndex);
				if (suffix) contents.push(suffix);
				return contents;
			}
		};
		let expandAttribute = attrValue => {
			let contents = expandPlaceholders(attrValue) || [attrValue];
			
			if (contents.length == 1 && typeof contents[0] != 'string') {
				return contents[0].m_value;
			}
			return (data, ...args) => {
				return contents.map(entry => {
					if (typeof entry === 'string') return entry;
					return entry.m_value(data, ...args);
				}).join("");
			};
		};

		function walk(node, nodePath) {
			if (node.childNodes) {
				node.childNodes.forEach((child, index) => {
					if (child.tagName === 'TEMPLATE') {
						let childTemplate = templateFromElementPlaceholders(child.content, placeholderMap, templateSet);
						child[templateCache] = childTemplate;

						for (let attr of child.attributes) {
							if (attr.name[0] === '@') {
								let getValue = expandAttribute(attr.value);
								
								let transform = templateSet.transforms[attr.name.substr(1)];
								if (typeof transform !== 'function') throw Error("Unknown transform: " + attr.name);
								childTemplate = transform(childTemplate, getValue, templateSet);
							}
						}

						let name = child.id || child.getAttribute('name');
						if (childTemplate && !name) { // if it's unnamed, it's for immediate use
							setup.push({
								m_path: nodePath.concat(index),
								m_fn: (node, updates, innerTemplate, getData) => {
									let binding = childTemplate(innerTemplate);
									node.replaceWith(binding.node);
									updates.push(combineUpdates(binding.updates));
								}
							});
						} else {
							child.replaceWith(makePlaceholderNode());
						}
					} else {
						walk(child, nodePath.concat(index));
					}
				});
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
											itemData = entry.m_value(data);
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
			// Attributes go after content updates
			if (node.attributes) {
				Array.from(node.attributes).forEach(attr => {
					if (attr.name[0] === '$') {
						let name = attr.name.substr(1);
						let getValue = expandAttribute(attr.value);
						node.removeAttribute(attr.name);
						
						// dash-separated to camelCase
						name = name.toLowerCase().replace(/-+(.)/g, (_, c) => c.toUpperCase());

						setup.push({
							m_path: nodePath,
							m_fn: (node, updates, innerTemplate, getData) => {
								if (name in templateSet.attributes) {
									cacheLatestData = true; // can't be sure we don't need it
									let activeUpdateValue = null;
									let valueFn = (...args) => {
										return getValue(activeUpdateValue || getData(), ...args);
									};
									let update = templateSet.attributes[name].call(node, node, valueFn);
									if (typeof update === 'function') {
										updates.push(data => {
											activeUpdateValue = data;
											update(data);
											activeUpdateValue = null;
										});
									}
									return;
								}
							
								if (('on' + name) in node) {
									cacheLatestData = true;
									node.addEventListener(name, e => {
										getValue(getData(), e, node);
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
				});
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
		transforms = {};
	
		constructor(parent) {
			this.#parent = parent;
			if (parent) {
				this.attributes = Object.create(parent.attributes);
				this.transforms = Object.create(parent.transforms);
			}

			/* Switches between templates, based on the filtered list */
			this.dynamic = innerTemplate => {
				let clearable = makeClearable();
				
				let currentTemplate, currentUpdates;
				let currentFilterObj = {};
				
				let update = data => {
					if (currentTemplate && currentFilterObj.filter(data)) {
						return currentUpdates(data);
					}

					currentTemplate = this.getForData(data, currentFilterObj);
					let binding = currentTemplate(innerTemplate || this.dynamic);
					currentUpdates = combineUpdates(binding.updates);
					currentUpdates(data);
					clearable.m_replace(binding.node);
				};

				return {node: clearable.m_node, updates: [update]};
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
			if (this.#parent) return this.#parent.getForData(data, extraResults);
			throw Error("No template for data");
		}
		
		fromElement(element, preventEval) {
			if (typeof element === 'string') {
				let el = document.querySelector(element);
				if (!el) throw Error("Invalid element:" + element);
				element = el;
			}
			if (element[templateCache]) return element[templateCache];
			
			let placeholderMap = isObject(preventEval) ? preventEval : {};
			let placeholderIndex = Object.keys(placeholderMap).length;

			let replaceString = (text, templateSet) => {
				let result = [];
				let start = /((\$[a-z_-]+)*)(\$?)\{/gi;
				for (;;) {
					let startLiteral = start.lastIndex;
					let match = start.exec(text);
					if (!match) {
						result.push(text.substr(startLiteral));
						break;
					}
					result.push(text.substr(startLiteral, match.index - startLiteral));
					
					let valueEntry = fn => {
						let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
						placeholderMap[placeholder] = {
							m_template: templateFromIds(
								this,
								match[1].split('$').slice(1)
							),
							m_value: fn
						};
						result.push(placeholder);
					};

					let startExpr = start.lastIndex, endExpr = startExpr;
					if (match[3]) { // ${...} expression
						if (preventEval) {
							result.push(match[0]);
							continue;
						}
						let stack = ['}'];
						while (endExpr < text.length && stack.length) {
							let closeChar = stack[stack.length - 1];
							let c = text[endExpr++];
							if (c == '\\') {
								++endExpr;
							} else if (c == closeChar) {
								stack.pop();
							} else if (closeChar == '`') {
								if (c == '$' && text[endExpr + 1] == "{") {
									stack.push("}");
									++endExpr;
								}
							} else if (closeChar != '"' && closeChar != "'") {
								if (c == '{') {
									stack.push("}");
								} else if (c == '"' || c == "'" || c == '`') {
									stack.push(c);
								}
							}
						}
						if (stack.length) throw Error(`expected ${stack[0]}: ` + text);
						let expr = text.substr(startExpr, endExpr - startExpr - 1);
						try { // As well as syntax errors, will fail under CSP, so catch to be helpful
							valueEntry(new Function('return(' + expr + ')')());
						} catch (e) {
							console.error(e);
							result.push(`${e.message}`);
						}
						start.lastIndex = endExpr;
					} else { // A plain {...} expression
						if (text.substr(startExpr, 2) == '=}') {
							valueEntry(d => d);
							start.lastIndex += 2;
						} else {
							while (/[a-z_-]/i.test(text[endExpr])) {
								++endExpr;
							};
							if (endExpr > startExpr && text[endExpr] === '}') {
								let key = text.substr(startExpr, endExpr - startExpr);
								valueEntry(d => d[key]);
								start.lastIndex += key.length + 1;
							} else {
								result.push(match[0]);
							}
						}
					}
				}
				result = result.join("");
				return (result != text) ? result : null;
			};
			
			function walk(node, templateSet) {
				if (node.childNodes) {
					let childSet = null;
					// scan for sub-templates
					node.childNodes.forEach(child => {
						if (child.nodeType !== 1) return;
						if (child.tagName === 'TEMPLATE') {
							let name = child.id || child.getAttribute('name');
							for (let attr of child.attributes) {
								if (attr.name[0] === '@') {
									let newValue = replaceString(attr.value, templateSet);
									if (newValue !== null) attr.value = newValue;
								}
							}
							if (name) {
								if (!childSet) childSet = templateSet.extend();
								childSet.add(name, innerTmpl => {
									// it will be cached on the child element by the time this is called
									return child[templateCache](innerTmpl);
								});
							}
							walk(child.content, templateSet); // substitute the functions etc. in the same pass
						}
					});
					if (childSet) templateSet = childSet;
				}
				if (node.nodeType === 1) { // element
					for (let attr of node.attributes) {
						if (attr.name[0] == '$') {
							let newValue = replaceString(attr.value, templateSet);
							if (newValue !== null) attr.value = newValue;
						}
					}
				} else if (node.nodeType === 3) { // text
					let newValue = replaceString(node.nodeValue, templateSet);
					if (newValue !== null) node.nodeValue = newValue;
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
			
			let parts = [strings[0]];
			for (let i = 0; i < values.length; ++i) {
				if (typeof values[i] === 'function') {
					let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
					let entry = {
						m_template: t => t(t),
						m_value: values[i]
					};
					// Steal prefixes from the previous string
					parts[i] = parts[i].replace(/(\$[a-z_-]+)*$/, prefixes => {
						entry.m_template = templateFromIds(this, prefixes.split('$').slice(1));
						return "";
					});
					placeholderMap[placeholder] = entry;
					parts.push(placeholder);
				} else {
					parts.push(values[i] + "");
				}
				
				parts.push(strings[i + 1]);
			}
			
			let element = document.createElement('template');
			element.innerHTML = parts.join("");
			return this.fromElement(element, placeholderMap);
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
			clearBetween(before, after);
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
				if (mergeValue === noChangeSymbol) return;
				
				if (Array.isArray(data)) {
					if (!updateList) {
						clear();
						updateList = [];
					}
					
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
	globalSet.transforms.data = (template, dataFn, templateSet) => {
		if (dataFn == '') dataFn = (x => x);
		if (typeof dataFn != 'function') throw Error("needs a data-function argument");
		return innerTemplate => {
			let binding = template(innerTemplate);
			let combined = combineUpdates(binding.updates);
			binding.updates = [data => {
				combined(dataFn(data));
			}];
			return binding;
		};
	};
	globalSet.transforms.foreach = (template, dataFn, templateSet) => {
		let list = templateSet.getNamed('list');
		let listTemplate = innerTemplate => list(_ => template(innerTemplate));
		return globalSet.transforms.data(listTemplate, dataFn, templateSet);
	};
	globalSet.transforms['if'] = (conditionalTemplate, dataFn, templateSet) => {
		return innerTemplate => {
			let clearable = makeClearable();

			let conditionalUpdates = null;
			return {
				node: clearable.m_node,
				updates: [data => {
					if (dataFn(data)) {
						if (conditionalUpdates) {
							conditionalUpdates(data);
						} else {
							let binding = conditionalTemplate(innerTemplate);
							conditionalUpdates = combineUpdates(binding.updates);
							conditionalUpdates(data);
							clearable.m_replace(binding.node);
						}
					} else {
						if (conditionalUpdates) {
							clearable.m_replace();
							conditionalUpdates = null;
						}
					}
				}]
			};
		};
	};
	
	function scoped(getTemplate) {
		return innerTemplate => {
			let combined; // combined updates

			let clearable = makeClearable();
			
			return {
				node: clearable.m_ode,
				updates: [
					data => {
						let untracked = merge.withoutHidden(access.pierce(data));
						// clear any previous renders
						let template = getTemplate(untracked);
						let binding = template(innerTemplate);
						clearable.m_replace(binding.node);
						combined = combineUpdates(binding.updates);
					},
					data => combined(data)
				]
			};
		};
	}
	globalSet.transforms.scoped = t => t;
	
	function Wrapped(data, synchronous) {
		let mergeTracked;
		let updateFunctions = [];
		let sendUpdate = (mergeObj, fromExternalMethod) => {
			updateFunctions.forEach(obj => {
				if (!fromExternalMethod || obj.m_notifyExternal) obj.m_fn(mergeObj)
			});
		};
		// Register for merge updates
		this.trackMerges = (fn, notifyExternal) => {
			updateFunctions.push({
				m_fn: fn,
				m_notifyExternal: !!notifyExternal
			});
			return this;
		};
		this.addUpdates = (updates, notifyExternal) => {
			let combined = combineUpdates([].concat(updates));
			this.trackMerges(mergeObj => {
				let withMerge = Matsui.merge.addHidden(mergeTracked, mergeObj);
				combined(withMerge);
			}, notifyExternal);
			combined(mergeTracked);
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
			sendUpdate(mergeObj, true);
		};
		this.setData = newData => {
			let mergeObj = merge.make(data, newData);
			setData(newData);
			sendUpdate(mergeObj, true);
		};
		
		let addBinding = (host, template, templateSet, replace) => {
			if (typeof host === 'string') host = document.querySelector(host);
			if (!host) throw Error("invalid host");

			if (typeof template === 'string') {
				template = document.querySelector(template);
				if (template) template = globalSet.fromElement(template);
			}

			// We might be handed just the template set, but no template
			if (!templateSet && typeof template != 'function') {
				templateSet = template;
				template = null;
			}
			templateSet = templateSet || globalSet;

			if (!template) template = templateSet.fromElement(host);

			let bindingInfo = template(templateSet.dynamic);
			this.addUpdates(bindingInfo.updates);
			
			let node = bindingInfo.node;
			if (replace) {
				if (host !== node) { // it might be filling out existing nodes in-place
					host.replaceWith(node);
				}
			} else {
				host.append(node);
			}
		};
		this.addTo = (element, template, templateSet) => {
			addBinding(element, template, templateSet, false);
			return this;
		};
		this.replace = (element, templateOrSet, templateSet) => {
			addBinding(element, templateOrSet, templateSet, true);
			return this;
		};
	}
	
	let api = {
		merge: merge,
		access: access,
		combineUpdates: combineUpdates,

		global: globalSet,
		Wrapped: Wrapped,
		wrap: data => new Wrapped(data),
		addTo: (element, data, template) => {
			return api.wrap(data).addTo(element, template);
		},
		replace: (element, data, template) => {
			return api.wrap(data).replace(element, template);
		}
	}
	return api;
})();
