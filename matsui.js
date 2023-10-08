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

	// pierces all Matsui proxies to get the underlying data (for equality comparison)
	let rawKey = Symbol();
	function getRaw(value) {
		if (!isObject(value)) return value;
		let raw = value[rawKey];
		while (raw && raw != value) {
			value = raw;
			raw = value[rawKey];
		}
		return value;
	}

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
						trackerObj[accessedKey] = accessedKey; // arrow functions, bound functions, and some native methods have no .prototype - more likely to not go through 'this' if they access stuff
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

	/*--- Combining updates ---*/

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

	/*--- HTML template ---*/

	function instantiateTemplateWithIds(templateSet, ids, innerTemplate) {
		let named = ids.map(name => templateSet.getNamed(name));
		function getTemplate(depth) {
			if (depth >= ids.length) return innerTemplate;
			let template = named[depth];
			return _ => {
				return template(getTemplate(depth + 1));
			};
		};
		return getTemplate(0)(templateSet.dynamic);
	}
	
	let exprStartRegex = /\$\{/g;
	function replaceExprs(text, foundExpr) {
		let prevEnd = 0;
		let match, result = [];
		// Find end of expression by balanced bracket/quote matching
		while ((match = exprStartRegex.exec(text))) {
			result.push(text.substr(prevEnd, match.index - prevEnd)); // prefix/joiner
			let stack = ['}'];
			let startExpr = match.index + 2, endExpr = startExpr;
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
				result.push(foundExpr(expr));
			} catch (e) {
				console.error(e);
				result.push(`\{${e.message}\}`);
			}
			exprStartRegex.lastIndex = endExpr;
			prevEnd = endExpr;
		}
		result.push(text.substr(prevEnd));
		return result.join("");
	}
	function attributeValueToDataFn(value) {
		let parts = value.split(exprRegex);
		for (let i = 1; i < parts.length; i += 2) {
			let plainOrPlaceholder = parts[i];
			if (plainOrPlaceholder[0] == '{') {
				let key = plainOrPlaceholder.substr(1, plainOrPlaceholder.length - 2);
				if (key == '=') {
					parts[i] = (pMap => d => d);
				} else {
					parts[i] = (pMap => d => d[key]);
				}
			} else {
				parts[i] = (pMap => pMap[plainOrPlaceholder]);
			}
		}
		
		return placeholderMap => {
			let fullParts = parts.map(p => {
				if (typeof p == 'function') return p(placeholderMap);
				return p;
			}).filter(x => (x != ''));
			if (fullParts.length == 1 && typeof fullParts[0] == 'function') {
				// Attribute is just a single value, so return it without casting to string
				return fullParts[0];
			} else {
				return data => {
					return fullParts.map(p => {
						if (typeof p == 'function') return p(data);
						return p;
					}).join("");
				};
			}
		};
	}
	function isTemplate(element) {
		if (element.tagName == 'TEMPLATE') return true;
		for (let attr of element.attributes || []) {
			if (attr.name[0] == '@') return true;
		}
	}
	// $dash-separated or @dash-separated => camelCase
	function getAttrKey(attrName) {
		return attrName.substr(1).toLowerCase().replace(/-+(.)/g, (_, c) => c.toUpperCase());
	}
	function defaultAttributeFunction(node, attrKey, handler) {
		if (('on' + attrKey) in node) {
			node.addEventListener(attrKey, handler);
		} else if (attrKey in node) {
			return d => {
				node[attrKey] = handler();
			};
		} else {
			return d => {
				node.setAttribute(attrKey, handler());
			};
		}
	}
	
	// Arbitrarily-picked vendor-reserved Unicode points
	let placeholderPrefix = '\uF74A', placeholderSuffix = '\uF74B';
	let exprRegex = /(\{[a-z0-9_=-]+\}|\uF74A[0-9]+\uF74B)/uig;
	let taggedExprRegex = /((\$[a-z0-9_-]+)*)(\{([a-z0-9_=-]+)\}|\uF74A[0-9]+\uF74B)/uig;
	let subTemplatePlaceholderKey = Symbol();
	function getPendingTemplate(definitionElement) {
		let cloneable = definitionElement.content || definitionElement;
		let setupTemplateSet = [];

		// immediate <template> children with name="..." extend the template set
		let namedChildTemplates = {}, hasNamedChildren = false;
		Array.from(cloneable.childNodes).forEach(child => {
			if (child.tagName == 'TEMPLATE') {
				let name = child.getAttribute('name');
				if (name) {
					hasNamedChildren = true;
					namedChildTemplates[name] = {
						m_pending: getPendingTemplate(child),
						m_placeholderKey: child[subTemplatePlaceholderKey]
					};
					child.remove();
				}
			}
		});
				
		function walkTextNode(templateNode, nodePath) {
			let nodeValue = templateNode.nodeValue;
			let match, prevIndex = 0;
			while ((match = taggedExprRegex.exec(nodeValue))) {
				let prefixString = nodeValue.substr(prevIndex, match.index - prevIndex);
				prevIndex = taggedExprRegex.lastIndex;
				
				let ids = match[1].split('$').slice(1); // $...$... section
				
				let plainOrPlaceholder = match[3], key = match[4];
				let fixedValue = key && (key == '=' ? (d => d) : (d => d ? d[key]: null));
				setupTemplateSet.push((templateSet, placeholderMap) => {
					let value = fixedValue || placeholderMap[plainOrPlaceholder];
					return {
						m_nodePath: nodePath,
						m_fn: (node, updates, innerTemplate) => {
							if (prefixString) node.before(prefixString);
							
							let binding = instantiateTemplateWithIds(templateSet, ids, innerTemplate);
							let combined = combineUpdates(binding.updates);
							node.before(binding.node);

							if (typeof value == 'function') {
								updates.push(data => {
									combined(value(data));
								});
							} else {
								combined(value);
							}
						}
					};
				});
			}
			if (prevIndex > 0) { // any remaining parts of the string (if we found any matches)
				let suffix = nodeValue.substr(prevIndex);
				let setupFn = suffix ? (node => node.nodeValue = suffix) : node => node.remove();
				setupTemplateSet.push(_ => ({
					m_nodePath: nodePath,
					m_fn: setupFn
				}));
			}
		}
				
		function walkAttribute(attr, nodePath) {
			if (attr.name[0] != '$') return;
			let attrKey = getAttrKey(attr.name);
			let getDataFn = attributeValueToDataFn(attr.value);

			setupTemplateSet.push((templateSet, placeholderMap) => {
				let dataFn = getDataFn(placeholderMap);
				return {
					m_nodePath: nodePath,
					m_fn: (node, updates, innerTemplate) => {
						let latestData = null;
						let valueFn = () => dataFn(latestData);

						let maybeUpdate;
						if (attrKey in templateSet.attributes) {
							maybeUpdate = templateSet.attributes[attrKey](node, valueFn);
						} else {
							maybeUpdate = defaultAttributeFunction(node, attrKey, valueFn);
						}
						updates.push(data => {
							latestData = data;
							if (maybeUpdate) maybeUpdate(data);
							latestData = merge.withoutHidden(data);
						});
					}
				};
			});
		}
		
		function walk(templateNode, nodePath) {
			if (templateNode.nodeType == 3) {
				walkTextNode(templateNode, nodePath);
			} else if (templateNode.nodeType === 1) {
				if (isTemplate(templateNode)) { // render template in-place
					let subMapKey = templateNode[subTemplatePlaceholderKey];
					let pendingTemplate = getPendingTemplate(templateNode);
					setupTemplateSet.push((templateSet, placeholderMap) => {
						let subPlaceholderMap = {};
						if (subMapKey) {
							placeholderMap[subMapKey](subPlaceholderMap);
						} else {
							subPlaceholderMap = placeholderMap;
						}
						let inPlaceTemplate = pendingTemplate(templateSet, subPlaceholderMap);
						return {
							m_nodePath: nodePath,
							m_fn: (node, updates, innerTemplate) => {
								let binding = inPlaceTemplate(innerTemplate);
								node.replaceWith(binding.node);
								updates.push(combineUpdates(binding.updates));
							}
						};
					});
					templateNode.replaceWith(makePlaceholderNode());
				} else {
					for (let attr of templateNode.attributes) {
						walkAttribute(attr, nodePath);
					}
				}
			}
			(templateNode.childNodes || []).forEach((child, index) => {
				walk(child, nodePath.concat(index));
			});
		}
		walk(cloneable, []);
		
		let templateTransforms = {};
		for (let attr of definitionElement.attributes || []) {
			if (attr.name[0] == '@') {
				let attrKey = getAttrKey(attr.name);
				templateTransforms[attrKey] = attributeValueToDataFn(attr.value);
			}
		}

		return (templateSet, placeholderMap) => {
			if (hasNamedChildren) {
				templateSet = templateSet.extend();
				for (let name in namedChildTemplates) {
					let obj = namedChildTemplates[name];
					let subPlaceholderMap = {}, subMapKey = obj.m_placeholderKey;
					if (subMapKey) {
						placeholderMap[subMapKey](subPlaceholderMap);
					} else {
						subPlaceholderMap = placeholderMap;
					}
					let template = obj.m_pending(templateSet, subPlaceholderMap);
					templateSet.add(name, template);
				}
			}
		
			let setupTemplate = setupTemplateSet.map(fn => fn(templateSet, placeholderMap));
			let result = innerTemplate => {
				let node = cloneable;
				cloneable = cloneable.cloneNode(true);
				
				let updates = [];
				let subNodes = setupTemplate.map(obj => {
					let n = node;
					obj.m_nodePath.forEach(i => (n = n.childNodes[i]));
					return n;
				});
				setupTemplate.forEach((obj, index) => {
					obj.m_fn(subNodes[index], updates, innerTemplate);
				});
				
				return {node: node, updates: updates};
			};
			for (let key in templateTransforms) {
				let transform = templateSet.transforms[key];
				if (!transform) throw Error("Unknown transform: " + key);
				result = transform(result, templateTransforms[key](placeholderMap), templateSet);
			}
			return result;
		};
	}

	let elementTemplateCache = Symbol();
	let tagCache = new WeakMap();
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
		
		fromElement(element) {
			if (typeof element === 'string') {
				let el = document.querySelector(element);
				if (!el) throw Error("Invalid element:" + element);
				element = el;
			}
			if (!element[elementTemplateCache]) {
				// Concatenates ${...} and <script>s into JS code which fills out a placeholder object
				let placeholderIndex = 0;
				let objArg = '__matsui_template_map';
				let codeParts = [];
				function walk(node, ignoreTemplate) {
					function foundExpr(expr) {
						let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
						codeParts.push(`;${objArg}[${JSON.stringify(placeholder)}]=(${expr});`);
						return placeholder;
					}

					if (node.nodeType === 3) {
						let startIndex = placeholderIndex;
						let replacement = replaceExprs(node.nodeValue, foundExpr);
						if (placeholderIndex > startIndex) { // if we found any expressions, the index increments
							node.nodeValue = replacement;
						}
					} else if (node.nodeType === 1) {
						if (node.tagName == 'SCRIPT') {
							if (node.getRootNode().nodeType == 11) { // document fragment (which means it's not part of the main document)
								node.replaceWith(makePlaceholderNode());
								return codeParts.push(node.textContent);
							}
						}
						if (isTemplate(node) && !ignoreTemplate) {
							let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
							node[subTemplatePlaceholderKey] = placeholder;
							// sub-templates have their own placeholder-filling function
							codeParts.push(`;${objArg}[${JSON.stringify(placeholder)}]=${objArg}=>{`);
							walk(node.content || node, true);
							codeParts.push('};');
							return;
						}
						for (let attr of node.attributes) {
							if (attr.name[0] == '$') {
								attr.value = replaceExprs(attr.value, foundExpr);
							}
						}
					}
					if (node.childNodes) {
						node.childNodes.forEach(c => walk(c));
					}
				}
				let content = element.content || element;
				walk(content, true);

				let fillPlaceholderMap = (_ => _);
				if (codeParts.length) {
					console.log(codeParts.join('\n'));
					fillPlaceholderMap = new Function(objArg, codeParts.join('\n'));
				}
				let pendingTemplate = getPendingTemplate(element);
				element[elementTemplateCache] = templateSet => {
					let map = {};
					fillPlaceholderMap(map);
					return pendingTemplate(templateSet, map);
				};
			}
			return element[elementTemplateCache](this);
		}
		
		fromTag(strings, ...values) {
			// Cache the HTML parsing
			let cached = tagCache.get(strings);
			if (!cached) {
				let parts = [strings[0]];
				for (let i = 0; i < values.length; ++i) {
					let placeholder = placeholderPrefix + i + placeholderSuffix;
					parts.push(placeholder);
					parts.push(strings[i + 1]);
				}

				let element = document.createElement('template');
				element.innerHTML = parts.join("");
				cached = getPendingTemplate(element);
				tagCache.set(strings, cached);
			}

			// fill with a map from the current values
			let placeholderMap = {};
			for (let i = 0; i < values.length; ++i) {
				let placeholder = placeholderPrefix + i + placeholderSuffix;
				placeholderMap[placeholder] = values[i];
			}

			return cached(this, placeholderMap);
		}
	}

	//------------------------------------------------------------------------
		
	/*--- Pre-supplied templates and template-construction methods ---*/

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
					throw Error("not implemented: object lists");
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

	function scoped(untrackedDataToTemplate) {
		return innerTemplate => {
			let combined; // combined updates

			let clearable = makeClearable();
			
			return {
				node: clearable.m_node,
				updates: [
					data => {
						// piercing the data only re-triggers when the object (or plain value) is replaced
						let untracked = merge.withoutHidden(access.pierce(data));
						let template = untrackedDataToTemplate(untracked);
						let binding = template(innerTemplate);
						clearable.m_replace(binding.node);
						combined = combineUpdates(binding.updates);
					},
					data => combined(data)
				]
			};
		};
	}
	globalSet.transforms.scoped = t => {throw Error('not implemented: @scoped')};

	/* Top-level stuff  */

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
		scoped: scoped,

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
