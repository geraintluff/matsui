"use strict"
self.Matsui = (() => {
	if (!Object.hasOwn) {
		Object.hasOwn = (o, p) => Object.prototype.hasOwnProperty.call(o, p);
	}
	
	let errors = [];

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

	// Attach a hidden merge to data, which we use later to decide what to re-render
	let hiddenMergeKey = Symbol(), hiddenMergePierceKey = Symbol();
	let noChangeSymbol = Symbol('no change'), isReplacementKey = Symbol('replace');

	let merge = {
		apply(value, mergeValue, valueIsMerge) {
			// simple types are just overwritten
			if (!isObject(mergeValue)) return mergeValue;
			if (!isObject(value)) {
				if (valueIsMerge) mergeValue[isReplacementKey] = true;
				return mergeValue;
			}
			// Arrays overwrite everything
			if (Array.isArray(mergeValue)) return mergeValue;
			
			if (mergeValue[isReplacementKey]) {
				if (valueIsMerge) {
					value[isReplacementKey] = true;
				} else {
					delete mergeValue[isReplacementKey];
				}
			}

			// They're both objects: mergey-merge
			Object.keys(mergeValue).forEach(key => {
				let childMerge = mergeValue[key];
				if (Object.hasOwn(value, key)) {
					if (childMerge == null && !valueIsMerge) {
						delete value[key];
					} else {
						value[key] = merge.apply(value[key], childMerge, valueIsMerge);
					}
				} else if (childMerge != null || valueIsMerge) { // deliberately matching both null/undefined
					value[key] = childMerge;
				}
			});
			return value;
		},
		make(fromValue, toValue, canBeUndefined) {
			if (canBeUndefined && fromValue === toValue) return;
			if (!isObject(toValue)) return toValue;
			if (!isObject(fromValue)) {
				toValue[isReplacementKey] = true;
				return toValue;
			}
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
			
			let actualUpdateFn = updateFn;
			let isRunning = false;
			let pendingMerge = noChangeSymbol, pendingMergeTimeout = null;
			let notifyPendingMerge = () => {
				clearTimeout(pendingMergeTimeout);
				if (pendingMerge != noChangeSymbol) {
					let merge = pendingMerge;
					pendingMerge = noChangeSymbol; // clear it first
					actualUpdateFn(merge);
				}
			}
			updateFn = mergeObj => {
				if (pendingMerge == noChangeSymbol) {
					pendingMerge = mergeObj;
				} else {
					pendingMerge = merge.apply(pendingMerge, mergeObj, true); // keep nulls because they're meaningful
				}
				if (asyncUpdates) {
					requestAnimationFrame(notifyPendingMerge);
					clearTimeout(pendingMergeTimeout);
					pendingMergeTimeout = setTimeout(notifyPendingMerge, 0);
				} else if (!isRunning) {
					while (pendingMerge != noChangeSymbol) {
						isRunning = true;
						notifyPendingMerge();
						isRunning = false;
					}
				}
			};
			
			let trackedProxy = (data, updateFn) => {
				return new Proxy(data, {
					get(obj, prop) {
						let value = obj[prop];
						if (prop == rawKey) return obj;
						// TODO: if it's a function without a .prototype (meaning it might be bound - see below) is there a way to let it run, but check for changes?  Or return a proxy function to do that when it's called (which could be later)?
						// That could also check for `this` being the proxy, and (before triggering) call the actual function on `obj` instead, which would handle methods which complain when called on the proxy (like Date::toString())
						if (!isObject(value)) return value;

						return trackedProxy(
							value,
							mergeObj => updateFn({
								[prop]: mergeObj
							})
						);
					},
					set(obj, prop, value, proxy) {
						if (value == null) return (delete proxy[prop]);
						value = getRaw(value);
						if (value === obj[prop]) return true;
						let propMerge = merge.make(obj[prop], value);
						if (isObject(propMerge)) {
							propMerge[isReplacementKey] = true;
						} else {
							// no change
							if (value === obj[prop]) return true;
						}
						if (Reflect.set(obj, prop, value)) {
							updateFn({[prop]: propMerge});
							return true;
						}
						return false;
					},
					deleteProperty(obj, prop) {
						if (!(prop in obj)) return true;
						if (delete obj[prop]) {
							updateFn({
								[prop]: null
							});
							return true;
						}
						return false;
					}
				});
			};
			return trackedProxy(data, updateFn);
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
			let mergeObj = getRaw(data[hiddenMergeKey]);
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
	
	let pierceKey = Symbol(), silentPierceKey = Symbol();
	let accessedKey = Symbol("accessed"), listKeysKey = Symbol('list-keys');
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
					if (prop == silentPierceKey) {
						return obj;
					} else if (prop == pierceKey) {
						trackerObj[accessedKey] = accessedKey;
						return obj;
					} else if (isArray && prop === 'length') {
						trackerObj[listKeysKey] = listKeysKey;
						return value;
					} else if (typeof value === 'function' && !value.prototype) {
						trackerObj[accessedKey] = accessedKey; // arrow functions, bound functions, and some native methods have no .prototype - more likely to not go through 'this' if they access stuff
						// TODO: now we've done that, should we return a bound version?
					}
					
					if (!(prop in trackerObj)) trackerObj[prop] = {};
					return access.tracked(value, trackerObj[prop]);
				},
				ownKeys(obj) { // We're being asked to list our keys - assume this means they're interested in the whole object (including key addition and deletion)
					trackerObj[listKeysKey] = listKeysKey;
					return Reflect.ownKeys(obj);
				}
			});
			return proxy;
		},
		pierce(tracked, silent) {
			return (tracked && tracked[silent ? silentPierceKey : pierceKey]) || tracked;
		},
		accessed: accessedKey
	};

	/*--- Combining updates ---*/

	let isCombinedKey = Symbol();
	let combineUpdates = (updateFunctions, mapFn) => {
		for (let i = 0; i < updateFunctions.length; ++i) {
			if (updateFunctions[i][isCombinedKey]) {
				// reduce recursion by replacing the already-combined updates with its component parts
				updateFunctions.splice(i, 1, ...updateFunctions[i][isCombinedKey]);
				--i;
			}
		}
		if (mapFn) {
			// Call the mapping function repeatedly - if we don't do this, the access-tracking doesn't realise we're using bits of the data
			// TODO: it would be great to be able to cache this, but we'd need the caching function to add its access pattern to all the subsequent ones as well - in a way which can be picked up by the flattening above
			updateFunctions = updateFunctions.map(fn => data => fn(mapFn(data)));
		}
		Object.freeze(updateFunctions);
		let firstRun = true;
		
		let updateAccess = [];

		let prevData = null;
		let combinedUpdate = data => {
			data = access.pierce(data); // stops tracking here, and registers this function for all updates
			
			let withoutMerge = merge.withoutHidden(data); // strip the merge info, which should force a full render
			let rawData = getRaw(withoutMerge); // strip all proxies to try and get a uniquely identifiable object

			if (firstRun || prevData !== rawData) { // run everything the first time
				prevData = isObject(rawData) ? rawData : null;
				firstRun = false;
				updateFunctions.forEach((fn, index) => {
					let trackerObj = updateAccess[index] = {};
					let tracked = access.tracked(withoutMerge, trackerObj); // no merge data -> should force a full render
					fn(tracked);
				});
				return;
			}
			
			// can't use data, because this is called post-merge
			function didAccess(trackerObj, mergeValue) {
				if (mergeValue == noChangeSymbol) return false;
				if (trackerObj[accessedKey]) return true;
				if (!isObject(mergeValue) || Array.isArray(mergeValue) || mergeValue[isReplacementKey]) return true;
				if (trackerObj[listKeysKey]) {
					for (let key in mergeValue) {
						if (didAccess(trackerObj[key] || {}, mergeValue[key])) return true;
					}
				} else {
					for (let key in mergeValue) {
						if (trackerObj[key] && didAccess(trackerObj[key], mergeValue[key])) return true;
					}
				}
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
		combinedUpdate[isCombinedKey] = updateFunctions;
		return combinedUpdate;
	}

	/*--- HTML template ---*/

	function instantiateTemplateWithIds(templateSet, ids, innerTemplate) {
		let named = ids.map(name => {
			let template = templateSet.named[name];
			if (template) return template;
			let message = "Template not found: " + name;
			console.error(message);
			return _ => {
				return {node: document.createTextNode(message), updates: []};
			};
		});
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
		// Find end of expression by brute-force: attempt a parse for every `}` we find, stop when we succeed
		while ((match = exprStartRegex.exec(text))) {
			result.push(text.slice(prevEnd, match.index)); // prefix/joiner
			
			let startExpr = match.index + 2, endExpr = startExpr + 1;
			let error;
			while (endExpr < text.length) {
				if (text[endExpr] == '}') {
					let candidate = text.slice(startExpr, endExpr);
					try {
						error = null;
						// This doesn't *run* the code, but it throws an error if the syntax is invalid
						new Function('return ' + candidate);
						break;
					} catch (e) {
						error = e;
					}
				}
				++endExpr;
			}
			
			if (error) {
				console.error(error);
				result.push(`{${error.message}}`);
				return result.join("");
			} else {
				result.push(foundExpr(text.slice(startExpr, endExpr)));
			}
			exprStartRegex.lastIndex = prevEnd = endExpr + 1;
		}
		result.push(text.slice(prevEnd));
		return result.join("");
	}
	function attributeValueToDataFn(value) {
		let parts = value.split(exprRegex);
		for (let i = 1; i < parts.length; i += 2) {
			let plainOrPlaceholder = parts[i];
			let key = plainOrPlaceholder.slice(1, -1);
			if (plainOrPlaceholder[0] == '{') {
				if (key == '=') {
					parts[i] = (() => d => d);
				} else {
					let keyPath = key.split('.');
					if (keyPath.length == 1) {
						keyPath = keyPath[0];
						parts[i] = () => d => d?.[keyPath];
					} else {
						parts[i] = () => d => {
							keyPath.forEach(key => {
								if (d && typeof d == 'object') d = d[key];
							});
							return d;
						};
					}
				}
			} else {
				parts[i] = (pMap => pMap[key]);
			}
		}
		
		return placeholderMap => {
			let fullParts = parts.map(p => {
				if (typeof p == 'function') {
					return p(placeholderMap);
				}
				return p;
			}).filter(x => (x != ''));
			if (fullParts.length == 1) {
				// Attribute is just a single value, so return it without casting to string
				return fullParts[0];
			} else if (!fullParts.some(p => (typeof p === 'function'))) {
				// Attribute is all fixed values, so return as a fixed string
				return fullParts.join("");
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
		return attrName.slice(1).toLowerCase().replace(/-+(.)/g, (_, c) => c.toUpperCase());
	}
	function defaultAttributeFunction(node, attrKey, handler) {
		if (('on' + attrKey) in node) {
			node.addEventListener(attrKey, e => handler(e, node));
		} else if (attrKey in node) {
			return d => {
				let v = handler();
				try {
					node[attrKey] = v;
				} catch (e) { // Write-only attributes will throw on assignment, so we fall back to attributes
					if (v == null) {
						node.removeAttribute(attrKey);
					} else {
						node.setAttribute(attrKey, v);
					}
				}
			};
		} else {
			return d => {
				let v = handler();
				if (v == null && node.hasAttribute(attrKey)) {
					node.removeAttribute(attrKey);
				} else if (node.getAttribute(attrKey) != v) {
					node.setAttribute(attrKey, v);
				}
			};
		}
	}
	
	// Arbitrarily-picked vendor-reserved Unicode points
	let placeholderPrefix = '\uF74A', placeholderSuffix = '\uF74B';
	let exprRegex = /(\{[a-z0-9_=\.-]+\}|\uF74A[0-9]+\uF74B)/uig;
	let taggedExprRegex = /((\$[a-z0-9_-]+)*)(\{([a-z0-9_=\.-]+)\}|\uF74A([0-9]+)\uF74B)/uig;
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
					let pendingFilter = (pMap => null);
					if (child.hasAttribute('$filter')) {
						pendingFilter = attributeValueToDataFn(child.getAttribute('$filter'));
					}
					namedChildTemplates[name] = {
						m_pending: getPendingTemplate(child),
						m_scoped: child.getAttribute('@scoped'),
						m_placeholderKey: child[subTemplatePlaceholderKey],
						m_filter: pendingFilter
					};
					child.remove();
				}
			}
		});
				
		function walkTextNode(templateNode, nodePath) {
			let nodeValue = templateNode.nodeValue;
			let match, prevIndex = 0;
			while ((match = taggedExprRegex.exec(nodeValue))) {
				let prefixString = nodeValue.slice(prevIndex, match.index);
				prevIndex = taggedExprRegex.lastIndex;
				
				let ids = match[1].split('$').slice(1); // $...$... section
				
				let plainKey = match[4], placeholderKey = match[5];
				let fixedValue = null;
				if (plainKey) {
					let keyPath = (plainKey == '=') ? [] : plainKey.split('.');
					fixedValue = d => {
						keyPath.forEach(key => {
							if (d && typeof d == 'object') d = d[key];
						});
						return d;
					};
				}
				setupTemplateSet.push((templateSet, placeholderMap) => {
					let value = fixedValue || placeholderMap[placeholderKey];
					if (typeof value === 'function') {
						if (ids[0] === 'template') {
							templateSet = templateSet.extend();
							templateSet.add('template', value);
							value = (d => d);
						} else if (ids[0] === 'scoped') {
							templateSet = templateSet.extend();
							let getTemplate = value;
							templateSet.add('scoped', scoped(data => getTemplate(data, templateSet)));
							value = (d => d);
						}
					}
					return {
						m_nodePath: nodePath,
						m_fn: (node, updates, innerTemplate) => {
							if (prefixString) node.before(prefixString);
							
							let binding = instantiateTemplateWithIds(templateSet, ids, innerTemplate);
							node.before(binding.node);

							if (typeof value == 'function') {
								updates.push(combineUpdates(binding.updates, value));
							} else {
								// The value is constant, just run all the updates immediately
								binding.updates.forEach(fn => fn(value));
							}
						}
					};
				});
			}
			if (prevIndex > 0) { // any remaining parts of the string (if we found any matches)
				let suffix = nodeValue.slice(prevIndex);
				let setupFn = suffix ? (node => node.nodeValue = suffix) : node => node.remove();
				setupTemplateSet.push(_ => ({
					m_nodePath: nodePath,
					m_fn: setupFn
				}));
			}
		}
				
		function walkAttribute(node, attr, nodePath) {
			if (attr.name[0] != '$') return;
			node.removeAttribute(attr.name);
			let literalName = attr.name[1] == '-';
			let attrKey = literalName ? attr.name.slice(2) : getAttrKey(attr.name);
			let getAttrFn = attributeValueToDataFn(attr.value);

			setupTemplateSet.push((templateSet, placeholderMap) => {
				let attr = getAttrFn(placeholderMap);
				let attrIsFn = (typeof attr === 'function');
				return {
					m_nodePath: nodePath,
					m_fn: (node, updates, innerTemplate) => {
						let latestData = null;
						let getLatest = () => latestData;
						// If the attribute is a function, bind the latest data as the first argument
						let boundAttr = attrIsFn ? (...args) => attr(latestData, ...args) : attr;

						let maybeUpdate;
						if (literalName) {
							maybeUpdate = d => {
								let v = attrIsFn ? boundAttr() : attr;
								if (v == null) {
									node.removeAttribute(attrKey);
								} else {
									node.setAttribute(attrKey, v);
								}
							};
						} else if (attrKey in templateSet.attributes) {
							maybeUpdate = templateSet.attributes[attrKey](node, boundAttr, getLatest);
						} else {
							let attrFn = attrIsFn ? boundAttr : () => attr;
							maybeUpdate = defaultAttributeFunction(node, attrKey, attrFn);
						}
						updates.push(data => {
							latestData = data;
							if (maybeUpdate) maybeUpdate(data);
							latestData = merge.withoutHidden(access.pierce(data, true));
						});
					}
				};
			});
		}
		
		function walk(templateNode, nodePath) {
			if (templateNode.nodeType == 3) {
				walkTextNode(templateNode, nodePath);
			} else if (templateNode.nodeType === 1) {
				if (isTemplate(templateNode) && nodePath.length) { // render template in-place (if it's not the top-level element)
					if (templateNode.tagName == 'TEMPLATE' && templateNode.hasAttribute('name')) {
						throw Error('<template name=""> can only be immediate child');
					}
					let subMapKey = templateNode[subTemplatePlaceholderKey];
					let pendingTemplate = getPendingTemplate(templateNode);
					setupTemplateSet.push((templateSet, placeholderMap) => {
						let inPlaceTemplate;
						if (templateNode.getAttribute("@scoped")) {
							// TODO: could we use this in the tagged version like <template @scoped>${scopedData => {...}</template> ?
							inPlaceTemplate = scoped(data => {
								let subPlaceholderMap = {};
								placeholderMap[subMapKey](subPlaceholderMap, data);
								return pendingTemplate(templateSet, subPlaceholderMap);
							});
						} else {
							let subPlaceholderMap = {};
							if (subMapKey) { // TODO: do we need to check this?  Seems like paranoia
								placeholderMap[subMapKey](subPlaceholderMap);
							} else {
								subPlaceholderMap = placeholderMap;
							}
							inPlaceTemplate = pendingTemplate(templateSet, subPlaceholderMap);
						}
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
					return;
				} else if (templateNode.tagName === 'SCRIPT') {
					return;
				} else {
					for (let attr of Array.from(templateNode.attributes)) {
						walkAttribute(templateNode, attr, nodePath);
					}
				}
			}
			(templateNode.childNodes || []).forEach((child, index) => {
				walk(child, nodePath.concat(index));
			});
		}
		walk(cloneable, []);
		
		let templateTransforms = {}, hasTemplateTransforms = false;
		for (let attr of definitionElement.attributes || []) {
			if (attr.name[0] == '@') {
				hasTemplateTransforms = true;
				let attrKey = getAttrKey(attr.name);
				if (attrKey != 'scoped') {
					templateTransforms[attrKey] = attributeValueToDataFn(attr.value);
				}
			}
		}

		return (templateSet, placeholderMap) => {
			let originalSet = templateSet; // so that transforms can do stuff with named siblings etc.
			if (hasNamedChildren || hasTemplateTransforms) {
				templateSet = templateSet.extend();
				for (let name in namedChildTemplates) {
					let obj = namedChildTemplates[name];
					let subMapKey = obj.m_placeholderKey;
					if (obj.m_scoped) {
						let template = scoped(data => { // only generate subPlaceholderMap when we have the scoped data
							let subPlaceholderMap = {};
							placeholderMap[subMapKey](subPlaceholderMap, data);
							return obj.m_pending(templateSet, subPlaceholderMap);
						});
						templateSet.add(name, template);
					} else {
						let subPlaceholderMap = {};
						if (subMapKey) {
							placeholderMap[subMapKey](subPlaceholderMap);
						} else {
							subPlaceholderMap = placeholderMap;
						}
						let filter = obj.m_filter(subPlaceholderMap);
						let template = obj.m_pending(templateSet, subPlaceholderMap);
						templateSet.add(name, template, filter);
					}
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
				result = transform(result, templateTransforms[key](placeholderMap), originalSet, templateSet);
			}
			return result;
		};
	}

	let elementTemplateCache = Symbol();
	let tagCache = new WeakMap();
	let codeAssemblyRegex = /\uF74A!?[0-9]+\uF74B/ug;
	let regexMarkedForRemoval = /^\uF74A![0-9]+\uF74B$/ug;
	class TemplateSet {
		attributes = {};
		transforms = {};
		named = {};
	
		constructor(parent) {
			this.#parent = parent;
			this.attributes = Object.create(parent ? parent.attributes : null);
			this.transforms = Object.create(parent ? parent.transforms : null);
			this.named = Object.create(parent ? parent.named : null);

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
					clearable.m_replace(binding.node);
					currentUpdates(data);
				};

				return {node: clearable.m_node, updates: [update]};
			}
		}
		
		#parent;
		#filtered = [];
		
		extend() {
			return new TemplateSet(this);
		}
		
		add(name, template, filter) {
			if (typeof template !== 'function' && template) {
				template = template.dynamic;
			}
			if (typeof template !== 'function') throw Error('Template not a function');
			if (name) this.named[name] = template;
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
				let filter = null;
				if (child.hasAttribute('$filter')) {
					filter = attributeValueToDataFn(child.getAttribute('$filter'))(null);
				}
				if (child.tagName === 'TEMPLATE' && name) {
					this.addElement(name, child, filter);
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
		addScoped(name, scopedTemplate, filter) {
			this.add(name, scoped(scopedTemplate), filter);
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
				let nextPlaceholder = markForRemoval => {
					return placeholderPrefix + (markForRemoval ? '!' : '') + (++placeholderIndex) + placeholderSuffix;
				};
				let objArg = '__matsui_template';
				let codeParts = {};

				function walk(node, ignoreTemplate) {
					function foundExpr(expr) {
						let placeholder = nextPlaceholder();
						codeParts[placeholder] = `${objArg}[${placeholderIndex}]=(${expr});`;
						return placeholder;
					}

					if (node.nodeType === 3) {
						let startIndex = placeholderIndex;
						let replacement = replaceExprs(node.nodeValue, foundExpr);
						if (placeholderIndex > startIndex) { // if we found any expressions, the index increments
							node.nodeValue = replacement;
						}
					} else if (node.nodeType === 1) {
						let tagName = node.tagName;
						if (tagName == 'SCRIPT') {
							if (node.getRootNode().nodeType == 11) { // document fragment (which means it's not part of the main document)
								let placeholder = nextPlaceholder(true);
								codeParts[placeholder] = node.textContent;
								node.textContent = placeholder;
							}
							return; // don't process <script>s any more than that
						}
						let processAttributes = _ => {
							for (let attr of node.attributes) {
								if (attr.name[0] == '$' || attr.name[0] == '@') {
									attr.value = replaceExprs(attr.value, foundExpr);
								}
							}
						};
						if (isTemplate(node) && !ignoreTemplate) {
							let prefixPlaceholder = nextPlaceholder(true);
							let placeholderKey = ++placeholderIndex + "";
							let suffixPlaceholder = nextPlaceholder(true);

							node[subTemplatePlaceholderKey] = placeholderKey;
							// sub-templates have their own placeholder-filling function
							node.before(document.createTextNode(prefixPlaceholder));
							let scopedVar = node.getAttribute('@scoped');
							let args = (scopedVar ? `(${objArg},${scopedVar})` : objArg);
							codeParts[prefixPlaceholder] = `${objArg}[${placeholderKey}]=${args}=>{`;

							processAttributes();
							walk(node.content || node, true);

							node.after(document.createTextNode(suffixPlaceholder));
							codeParts[suffixPlaceholder] = '};';
						} else {
							processAttributes();
							let child = node.firstChild;
							while (child) {
								walk(child);
								child = child.nextSibling;
							}
						}
					} else {
						let child = node.firstChild;
						while (child) {
							walk(child);
							child = child.nextSibling;
						}
					}
				}
				let content = element.content || element;
				walk(content, true);

				let scopedVar = element.getAttribute("@scoped");
				let fillPlaceholderMap = (x => x);
				if (Object.keys(codeParts).length) {
					let functionArgs = scopedVar ? `${objArg},${scopedVar}` : objArg;
					let functionBody = '/*' + element.outerHTML.replace(/\*\//g, '* /')
						.replace(codeAssemblyRegex, p => `*/${codeParts[p]}/*`) + '*/';
					fillPlaceholderMap = new Function(functionArgs, functionBody);
				}
				
				function removeMarkedNodes(node) {
					let text = (node.tagName == 'SCRIPT' ? node.textContent : node.nodeValue);
					if (regexMarkedForRemoval.test(text)) {
						node.remove();
					} else {
						let child = node.firstChild;
						while (child) {
							let next = child.nextSibling;
							removeMarkedNodes(child);
							child = next;
						}
						if (node.tagName == 'TEMPLATE') removeMarkedNodes(node.content);
					}
				}
				removeMarkedNodes(content);
				
				let pendingTemplate = getPendingTemplate(element);
				element[elementTemplateCache] = templateSet => {
					if (scopedVar) {
						return scoped(data => {
							let map = {};
							fillPlaceholderMap(map, data);
							return pendingTemplate(templateSet, map);
						});
					} else {
						let map = {};
						fillPlaceholderMap(map);
						return pendingTemplate(templateSet, map);
					}
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
					parts.push(placeholderPrefix + i + placeholderSuffix);
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
				placeholderMap[i] = values[i];
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
		let updateList, prevKeys;

		let pop = () => {
			let before = separators[separators.length - 2];
			let after = separators.pop();
			clearBetween(before, after);
			after.remove();
		}
		let clear = () => {
			while (separators.length > 1) pop();
			updateList = null;
			prevKeys = null;
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
				
				if (isObject(data)) {
					if (Array.isArray(data)) {
						if (!updateList || prevKeys) {
							clear();
							updateList = [];
						}
					} else { // TODO: this completely re-renders all later items if a key is removed
						let keys = Object.keys(data);
						data = keys.map(k => data[k]);

						if (!updateList || !prevKeys) {
							clear();
							updateList = [];
						} else {
							let diffIndex = 0;
							while (diffIndex < prevKeys.length && keys[diffIndex] == prevKeys[diffIndex]) {
								++diffIndex;
							}
							while (updateList.length > diffIndex) {
								pop();
								updateList.pop();
							}
						}
						prevKeys = keys;
					}
					
					// remove old entries
					while (updateList.length > data.length) {
						pop();
						updateList.pop();
					}
					// update existing entries
					updateList.forEach((update, index) => {
						let dataKey = prevKeys ? prevKeys[index] : index;
						if (dataKey in mergeValue) update(data[index]);
					});
					// add new entries
					while (updateList.length < data.length) {
						let index = updateList.length;
						
						let binding = innerTemplate(innerTemplate);
						let endSep = addSeparator();
						endSep.before(binding.node);

						let update = combineUpdates(binding.updates);
						updateList.push(update);
						update(data[index]);
					}
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
			binding.updates = [combineUpdates(binding.updates, dataFn)];
			return binding;
		};
	};
	globalSet.transforms.foreach = (template, dataFn, templateSet) => {
		let list = templateSet.named.list;
		let listTemplate = innerTemplate => list(_ => template(innerTemplate));
		return globalSet.transforms.data(listTemplate, dataFn, templateSet);
	};
	let latestIfKey = Symbol();
	globalSet.transforms['if'] = (conditionalTemplate, dataFn, templateSet) => {
		templateSet[latestIfKey] = dataFn;
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
							clearable.m_replace(binding.node);
							conditionalUpdates = combineUpdates(binding.updates);
							conditionalUpdates(data);
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
	globalSet.transforms['else'] = (template, _, templateSet) => {
		let ifCondition = templateSet[latestIfKey];
		if (!ifCondition) throw Error('@else must follow @if');
		template = globalSet.transforms['if'](template, d => !ifCondition(d), templateSet);
		delete templateSet[latestIfKey];
		return template;
	};

	function scoped(untrackedDataToTemplate) {
		return innerTemplate => {
			let combined; // combined updates
			let clearable = makeClearable();
			
			return {
				node: clearable.m_node,
				updates: [
					data => {
						let untracked = merge.withoutHidden(access.pierce(data, true));
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
			updates = [].concat(updates);
			this.trackMerges(mergeObj => {
				let withMerge = merge.addHidden(mergeTracked, mergeObj);
				updates.forEach(fn => fn(withMerge));
			}, notifyExternal);
			updates.forEach(fn => fn(mergeTracked));
		};

		let setData = newData => {
			data = newData;
			mergeTracked = merge.tracked(data, sendUpdate, !synchronous);
		};
		setData(data);

		Object.defineProperty(this, 'data', {
			get() {
				return mergeTracked;
			},
			set(newData) {
				let mergeObj = merge.make(data, newData);
				// DEBUG: showing this works
				if (isObject(mergeObj)) mergeObj[isReplacementKey] = true; // it's a full replacement
				setData(newData);
				sendUpdate(mergeObj, true);
				if (isObject(mergeObj)) delete mergeObj[isReplacementKey];
			}
		});
		// Make changes to the data
		this.merge = mergeObj => {
			let newData = merge.apply(data, mergeObj);
			if (newData !== data) setData(newData);
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
			let combined = combineUpdates(bindingInfo.updates);
			this.trackMerges(mergeObj => {
				let withMerge = merge.addHidden(mergeTracked, mergeObj);
				combined(withMerge);
			}, true);
			combined(mergeTracked);
			
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
	
	errors = new Wrapped(errors, true);
	
	let api = {
		merge: merge,
		access: access,
		combineUpdates: combineUpdates,
		getRaw: getRaw,

		global: globalSet,
		scoped: scoped,
		errors: errors,

		Wrapped: Wrapped,
		wrap(data, synchronous) {
			return new Wrapped(data, synchronous);
		},
		addTo: (element, data, template) => {
			return api.wrap(data).addTo(element, template);
		},
		replace: (element, data, template) => {
			return api.wrap(data).replace(element, template);
		}
	}
	return api;
})();
