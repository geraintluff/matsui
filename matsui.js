let Matsui = (() => {
	let isObject = data => (data && typeof data === 'object');

	/*--- JSON Patch Merge stuff ---*/

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
				} else if (childMerge != null) {
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
		watch(data, updateFn) {
			if (!isObject(data)) return data;
			return new Proxy(data, {
				get(obj, prop) {
					let value = Reflect.get(...arguments);
					if (!isObject(value)) return value;
					return merge.watch(
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
		// collects multiple changes together
		watchAsync(data, updateFn) {
			let pendingMerge = null, pendingMergeTimeout = null;
			let notifyPendingMerge = () => {
				clearTimeout(pendingMergeTimeout);
				if (pendingMerge) {
					updateFn(pendingMerge);
					pendingMerge = null;
				}
			}
			return merge.watch(data, mergeObj => {
				if (pendingMerge) {
					pendingMerge = merge.apply(pendingMerge, mergeObj, true); // keep nulls because they're meaningful
				} else {
					pendingMerge = mergeObj;
					requestAnimationFrame(notifyPendingMerge);
					pendingMergeTimeout = setTimeout(notifyPendingMerge, 0);
				}
			});
		}
	};

	/*--- Core stuff ---*/
	
	// Attach a hidden merge to data, which use later to decide what to re-render
	let hiddenMergeMap = new WeakMap();
	let noChangeSymbol = Symbol();
	function addHiddenMerge(data, mergeObj) {
		if (!isObject(data)) return data;
		let proxy = new Proxy(data, {
			get(obj, prop) {
				let value = Reflect.get(...arguments);
				return addHiddenMerge(value, mergeObj ? mergeObj[prop] : noChangeSymbol);
			}
		});
		hiddenMergeMap.set(proxy, mergeObj);
		return proxy;
	}
	function getHiddenMerge(data) {
		let entry = hiddenMergeMap.get(data);
		return (typeof entry == 'undefined') ? data : entry;
	}

	// Track which parts of a data are "accessed" (meaning either returning a non-object value, or explicitly pierced)
	let accessTrackingMap = new WeakMap();
	function addAccessTracking(data, leafAccessFn, keyPath) {
		let proxy = new Proxy(data, {
			get(obj, prop) {
				let value = Reflect.get(...arguments);
				let subPath = keyPath.concat(prop);
				if (isObject(value)) {
					return addAccessTracking(value, leafAccessFn, subPath);
				}
				leafAccessFn(subPath);
				return value;
			},
			ownKeys(obj) { // We're being asked to list our keys - assume this means they're interested in the whole object (including key addition and deletion)
				leafAccessFn(keyPath);
				return Reflect.ownKeys(obj);
			}
		});
		accessTrackingMap.set(proxy, {data: data, accessFn: leafAccessFn, keyPath: keyPath});
		return proxy;
	}
	function accessTracked(data) {
		let entry = accessTrackingMap.get(data);
		if (entry) {
			entry.accessFn(entry.keyPath);
			return entry.data;
		}
		return data;
	}

	// Use the above two concepts to (1) keep a map of what each update function accesses, and (2) only call the update functions affected by the hidden merge
	let updateTriggerSetKey = Symbol();
	function combineUpdatesWithTracking(updateFunctions) {
		let currentUpdateIndex = null;
		let updateTriggers;
		// Whenever a property in our data tree is accessed during a render update, we stick that update in a parallel tree structure
		let makeTracked = data => {
			if (!isObject(data)) return data;
			return addAccessTracking(data, keyPath => {
				if (currentUpdateIndex == null) throw Error("Huh?");
				let o = updateTriggers;
				keyPath.forEach(k => {
					if (!Object.hasOwn(o, k)) o[k] = {};
					o = o[k];
				});

				// Add the current update identifier to the trigger map
				if (!o[updateTriggerSetKey]) o[updateTriggerSetKey] = new Set();
				o[updateTriggerSetKey].add(currentUpdateIndex);
			}, []);
		}

		return data => {
			let tracked = makeTracked(data);

			if (!updateTriggers) { // first run - set up the trigger map and run all the updates
				updateTriggers = {};
				updateFunctions.forEach((fn, index) => {
					currentUpdateIndex = index;
					fn(tracked);
				});
				currentUpdateIndex = null;
				return;
			}

			let mergeValue = getHiddenMerge(data);

			// Collect all the updates (by index) referenced by the merge, removing them as we go
			let updateSet = new Set();
			function addUpdates(merge, triggers) {
				if (merge == noChangeSymbol) return;
				let updates = triggers[updateTriggerSetKey];
				if (updates) {
					updates.forEach(index => updateSet.add(index));
					updates.clear();
				}
				if (!isObject(merge)) return;
				Object.keys(merge).forEach(key => {
					if (Object.hasOwn(triggers, key)) addUpdates(merge[key], triggers[key]);
				});
			}
			addUpdates(mergeValue, updateTriggers);

			updateFunctions.forEach((fn, index) => {
				if (updateSet.has(index)) {
					currentUpdateIndex = index;
					fn(tracked);
				}
			});
			currentUpdateIndex = null;
		};
	}
	
	function SingleValueBind(endNode, template, innerTemplate) {
		let currentTemplateUpdate;

		let textNode;
		let prevNode = endNode.previousSibling;
		function clear() { // removes any nodes that have been added
			if (textNode) {
				textNode.remove();
				textNode = null;
			}
			currentTemplateUpdate = null;
			while (endNode.previousSibling && endNode.previousSibling != prevNode) {
				endNode.previousSibling.remove();
			}
		}

		this.update = data => {
			if (isObject(data)) {
				let untracked = accessTracked(data); // if this is being called from inside a DataTemplateBinding, terminate the access tracking here

				if (!currentTemplateUpdate) {
					clear();

					let bindingInfo = template(innerTemplate);
					currentTemplateUpdate = combineUpdatesWithTracking(bindingInfo.updates);
					currentTemplateUpdate(untracked);
					endNode.before(bindingInfo.node);
				} else {
					currentTemplateUpdate(untracked);
				}
			} else {
				if (!textNode) {
					clear();
					textNode = document.createTextNode("");
					endNode.before(textNode);
				}
				textNode.nodeValue = (data == null) ? "" : data;
			}
		};
		this.replaceTemplate = (newTemplate, newInnerTemplate) => {
			template = newTemplate;
			if (newInnerTemplate) innerTemplate = newInnerTemplate;
			clear();
		};
		this.remove = () => { // If we have several of these in a row, we'll want to remove just our own nodes.  Templates don't use this because they can just delete the whole tree
			clear();
			endNode.remove();
		};
	}

	function CompositeValueBind(itemFn, endNode, template, innerTemplate) {
		let arrayBinds = null, objectBinds = null;
		
		function clear() {
			if (objectBinds) {
				for (let key in objectBinds) {
					objectBinds[key].remove();
				}
				objectBinds = null;
			}
			if (arrayBinds) {
				arrayBinds.forEach(r => r.remove());
				arrayBinds = null;
			}
		}

		this.update = data => {
			let untracked = accessTracked(data); // terminate any access tracking here (so we get notified for everything)
			let mergeValue = getHiddenMerge(untracked); // and do our own filtering based on what's actually changed
			// If the data is a non-null object or array, the merge must either be one too, or there's no change
			if (mergeValue == noChangeSymbol) return;
			
			if (Array.isArray(untracked)) {
				if (objectBinds) clear();
				if (!arrayBinds) arrayBinds = [];

				// Remove old bindings
				while (arrayBinds.length > untracked.length) {
					arrayBinds.pop().remove();
				}
				for (let i = 0; i < arrayBinds.length; ++i) {
					// Update only the indices that are part of the merge
					if (i in mergeValue) arrayBinds[i].update(itemFn(i, untracked[i]));
				}
				// Add bindings for new items
				while (arrayBinds.length < untracked.length) {
					let index = arrayBinds.length;
					let itemEndNode = document.createTextNode("");
					endNode.before(itemEndNode);
					let bind = new SingleValueBind(itemEndNode, template, innerTemplate);
					arrayBinds.push(bind);

					let untrackedItem = itemFn(index, untracked[index]);
					bind.update(untrackedItem);
				}
			} else if (isObject(data)) {
				if (arrayBinds) clear();
				if (!objectBinds) objectBinds = {};
				// Remove old bindings
				Object.keys(objectBinds).forEach(key => {
					if (!Object.hasOwn(untracked, key)) {
						objectBinds[key].remove();
						delete objectBinds[key];
					}
				});
				for (let key in untracked) {
					// Add or update all bindings
					if (!Object.hasOwn(objectBinds, key)) {
						let itemEndNode = document.createTextNode("");
						endNode.before(itemEndNode);
						objectBinds[key] = new SingleValueBind(itemEndNode, template, innerTemplate);

						let untrackedItem = itemFn(key, untracked[key]);
						objectBinds[key].update(untrackedItem);
					} else if (Object.hasOwn(mergeValue, key)) {
						let untrackedItem = itemFn(key, untracked[key]);
						objectBinds[key].update(untrackedItem);
					}
				}
			} else {
				clear(); // not an array or object, just don't render anything
			}
		};
		this.remove = () => {
			clear();
			endNode.remove();
		};
	}
	
	let specialAttributes = {
		
	};

	/* scans a cloneable node tree, and adds setup functions to the nodeSetupList array */
	function scanElementTemplate(node, nodeSetupList, scopedTemplates, nodePath) {
		if (!node.childNodes) return;
		
		if (node.hasAttribute) {
			for (let key in specialAttributes) {
				if (node.hasAttribute(key)) {
					specialAttributes[key](node, )
				}
			}
		}

		// TODO: collect and turn them into a single inline `<script>` at the top level
		Array.from(node.childNodes).forEach(child => {
			if (child.tagName == "SCRIPT" && child.hasAttribute("@setup")) {
				let runScript = new Function("data", child.textContent);
				nodeSetupList.push((templateRoot, innerTemplate) => {
					let contextNode = templateRoot;
					nodePath.forEach(i => contextNode = contextNode.childNodes[i]);
					return runScript.call(contextNode);
				});
				node.removeChild(child);
			}
		});

		let newScopedTemplates = [];
		Array.from(node.childNodes).forEach(child => {
			if (child.tagName == 'TEMPLATE') {
				newScopedTemplates.push(templateFromElement(child));
				child.remove();
			}
		});
		if (newScopedTemplates.length) {
			scopedTemplates = newScopedTemplates.concat(scopedTemplates);
		}
		function getScopedTemplate(innerTemplate) {
			if (!scopedTemplates.length) return innerTemplate;
			return data => {
				for (let i = 0; i < scopedTemplates.length; ++i) {
					let template = scopedTemplates[i];
					if (template.filter(data)) return template(data);
				}
				return innerTemplate(data);
			};
		}
	
		for (let childIndex = 0; childIndex < node.childNodes.length; ++childIndex) {
			let child = node.childNodes[childIndex];
			
			if (child.nodeType == 1) {
				let childNodePath = nodePath.concat(childIndex);

				if (child.tagName == "SCRIPT" && child.hasAttribute("@expr")) {
					let placeholder = document.createTextNode("");
					child.replaceWith(placeholder);

					valueFn = new Function('data', "return " + child.textContent.trim());
					let extraTemplates = scopedTemplates;
					nodeSetupList.push((templateRoot, innerTemplate) => {
						let scopedTemplate = getScopedTemplate(innerTemplate);

						let endNode = templateRoot;
						childNodePath.forEach(i => endNode = endNode.childNodes[i]);

						let bind = new SingleValueBind(endNode, scopedTemplate, innerTemplate);
						return data => bind.update(valueFn(data));
					});
				} else if (child.tagName == "SCRIPT" && child.hasAttribute("@items")) {
					let placeholder = document.createTextNode("");
					child.replaceWith(placeholder);

					itemFn = new Function('key', 'value', "return " + child.textContent.trim());
					let extraTemplates = scopedTemplates;
					nodeSetupList.push((templateRoot, innerTemplate) => {
						let scopedTemplate = getScopedTemplate(innerTemplate);

						let endNode = templateRoot;
						childNodePath.forEach(i => endNode = endNode.childNodes[i]);

						let bind = new CompositeValueBind(itemFn, endNode, scopedTemplate, innerTemplate);
						return data => bind.update(data);
					});
				} else if (child.hasAttribute("@items")) { // turn this element into a template and use it for items (using this item expression)
				// TODO: we only needed this because some elements (e.g. a table) would move text nodes, but we could replace with <script @items> instead

					let itemExpr = child.getAttribute("@items");
					if (itemExpr[0] == '>') itemExpr = "(key,value)=" + itemExpr
					let itemFn = itemExpr ? eval(itemExpr) : ((key, value) => value);
					
					let placeholder = document.createTextNode("");
					child.replaceWith(placeholder); // has same path
					
					child.removeAttribute("@items"); // just for neatness
					let itemTemplate = templateFromElement(child);
					nodeSetupList.push((templateRoot, innerTemplate) => {
						// find our placeholder
						let endNode = templateRoot;
						childNodePath.forEach(i => endNode = endNode.childNodes[i]);

						let scopedTemplate = getScopedTemplate(innerTemplate);
						let scopedItemTemplate = nullButWeIgnoreIt => {
							return itemTemplate(scopedTemplate);
						}
						let bind = new CompositeValueBind(itemFn, endNode, scopedItemTemplate, null);
						return bind.update;
					});
				} else {
					scanElementTemplate(child, nodeSetupList, scopedTemplates, childNodePath);
				}
			} else if (child.nodeType == 3) {
				let parts = child.nodeValue.split(/\{\{((\}?[^\}])*)\}\}/); // {{prop}}
				if (parts.length == 1) continue; // no template

				let nextChild = child.nextSibling;
				let prefix = parts.shift();
				if (prefix) {
					child.nodeValue = prefix;
				} else {
					node.removeChild(child);
					--childIndex;
				}
				// childIndex is now the index before nextChild
				
				while (parts.length > 1) {
					let prop = parts.shift().trim();
					parts.shift(); // last inner match isn't useful to us
					let suffix = parts.shift() || "";

					let endNode = document.createTextNode("|"); // placeholder text node (not empty because in some edge-cases (cross-document stuff in IE11) it's removed by cloning)
					node.insertBefore(endNode, nextChild);
					++childIndex;
					let endNodePath = nodePath.concat(childIndex);
					
					endNode.nodeValue = "(pending)";
					
					if (prop[0] == '#') {
						let itemExpr = prop.substr(1).trim();
						if (itemExpr[0] == '>') itemExpr = "(key, value) =" + itemExpr
						let itemFn = itemExpr ? eval(itemExpr) : ((key, value) => value);

						nodeSetupList.push((templateRoot, innerTemplate) => {
							let scopedTemplate = getScopedTemplate(innerTemplate);

							let endNode = templateRoot;
							endNodePath.forEach(i => endNode = endNode.childNodes[i]);
							endNode.nodeValue = suffix;
							let bind = new CompositeValueBind(itemFn, endNode, scopedTemplate, innerTemplate);
							return bind.update;
						});
					} else {
						let valueFn;
						if (prop == "=") {
							valueFn = (state => state);
						} else if (prop[0] == '=') {
							let valueExpr = prop.substr(1).trim();
							if (valueExpr[0] == '>') valueExpr = "data =" + valueExpr
							valueFn = valueExpr ? eval(valueExpr) : (value => value);
						} else {
							valueFn = (state => state[prop]);
						}
						let extraTemplates = scopedTemplates;
						nodeSetupList.push((templateRoot, innerTemplate) => {
							let scopedTemplate = getScopedTemplate(innerTemplate);

							let endNode = templateRoot;
							endNodePath.forEach(i => endNode = endNode.childNodes[i]);
							endNode.nodeValue = suffix;
							let bind = new SingleValueBind(endNode, scopedTemplate, innerTemplate);
							return data => bind.update(valueFn(data));
						});
					}
				}
			} else {
				scanElementTemplate(child, nodeSetupList, scopedTemplates, nodePath.concat(childIndex));
			}
		}
	}
	let templateCacheSymbol = Symbol();
	let templateFromElement = element => {
		if (element[templateCacheSymbol]) return element[templateCacheSymbol];
		
		let cloneable = element.content || element;
		let setupFunctions;

		let result = innerTemplate => {
			if (!setupFunctions) { // Lazy parsing
				scanElementTemplate(cloneable, setupFunctions = [], [], []);
			}

			// we use the original and store a clone for future use
			let node = cloneable;
			cloneable = cloneable.cloneNode(true);
			
			let updates = [];
			setupFunctions.forEach(fn => {
				let update = fn(node, innerTemplate);
				if (update) updates.push(update);
			});
			return {node: node, updates: updates};
		};
		let filterExpr = element.getAttribute && element.getAttribute("@filter");
		result.filter = new Function('data', 'return ' + (filterExpr || 'true'));
		if (element.id) result.id = element.id;
		return element[templateCacheSymbol] = result;
	};
	function templateFromHtmlDefault(html) {
		let template = document.createElement("template");
		template.innerHTML = html;
		return templateFromElement(template);
	}
	let templateFromHtml = templateFromHtmlDefault;

	let fallbackTemplate = templateFromHtml(`<template @filter="Array.isArray(data)"><details><summary>[{{=a=>a.length}} items]</summary><ol><li @items="(k,v)=>[v]">{{0}}</li></ol></details></template><template><details @items="(k,v)=>[k,v]" style="width:100%;box-sizing:border-box;font-size:0.8rem;line-height:1.2"><summary style="opacity:0.75;font-style:italic;cursor:pointer">{{0}}</summary><div style="margin-inline-start:2em;margin-inline-start:calc(min(4em,10%))">{{1}}</div></details></template>{{=}}`);
	function templateFromList(list) {
		return innerTemplate => {
			let node = document.createDocumentFragment();
			let endNode = document.createTextNode("");
			node.append(endNode);
			
			let currentTemplate
			let valueBinding = new SingleValueBind(endNode, fallbackTemplate, innerTemplate);
			
			function update(data) {
				if (currentTemplate) {
					if (!currentTemplate.filter || currentTemplate.filter(data)) { // still OK to render this data
						return valueBinding.update(data);
					}
				}
				// Find a new template
				currentTemplate = fallbackTemplate;
				for (let i = 0; i < list.length; ++i) {
					let template = list[i];
					if (!template.filter || template.filter(data)) {
						currentTemplate = template;
						break;
					}
				}
				valueBinding.replaceTemplate(currentTemplate);
				valueBinding.update(data);
			}

			return {node: node, updates: [update]};
		}
	}

	function TrackedDisplay(host, data, template, innerTemplate, replaceHost) {
		let updateDisplay;
		if (replaceHost) { // Replaces the host instead of adding to it - but it will now always use the template, never a basic value
			let bindingInfo = template(innerTemplate || fallbackTemplate), bindingNode = bindingInfo.node;
			if (host != bindingNode) host.replaceWith(bindingNode); // if the template was created from the host (so we're filling out an existing element), they could be the same
			updateDisplay = combineUpdatesWithTracking(bindingInfo.updates);
		} else {
			let endNode = document.createTextNode("");
			host.append(endNode); // happens before the bind so it can identify the start
			let bind = new SingleValueBind(endNode, template, innerTemplate || fallbackTemplate);
			updateDisplay = bind.update;
		}

		// Provide updates
		let updateFunctions = [];
		let updateAndNotify = mergeObj => {
			updateFunctions.forEach(fn => fn(mergeObj));
		};
		this.track = fn => {
			updateFunctions.push(fn);
			return this;
		};

		let tracked;
		let setData = newData => {
			data = newData;
			tracked = merge.watchAsync(data, updateAndNotify);
		};
		setData(data);
		updateDisplay(tracked);
		this.data = () => {
			return tracked;
		};
		
		let notifyMerged = mergeObj => {
			let withHiddenMerge = addHiddenMerge(tracked, mergeObj);
			updateDisplay(withHiddenMerge);
		};
		updateFunctions.push(notifyMerged);
		// If you have already changed `data`, but want to tell us about it
		this.notifyMerged = notifyMerged;

		// Make changes to the data
		this.merge = mergeObj => {
			let newData = merge.apply(data, mergeObj);
			if (newData != data) setData(newData);
			notifyMerged(mergeObj);
		};
		this.replace = newData => {
			let mergeObj = newData;
			if (replaceHost) {
				mergeObj = merge.make(data, newData);
			} else {
				updateDisplay(null); // clears the render down to just a text node
			}
			setData(newData);
			notifyMerged(mergeObj);
		};
	}
	
	let api = {
		merge: merge,
		template: {
			// If the templates have an extra `.filter()` function, they can decline to render the data.  This uses the first template which accepts the data (or has no `.filter()`).
			fromList(list) {
				return templateFromList(list);
			},

			// HTML templates
			fromHtml(html) {
				return templateFromHtml(html);
			},
			fromElement(element) {
				return templateFromElement(element);
			},
			fromElements: nodeListOrQuery => {
				if (typeof nodeListOrQuery == 'string') nodeListOrQuery = document.querySelectorAll(nodeListOrQuery);
				let list = [];
				nodeListOrQuery.forEach(element => list.push(templateFromElement(element)));
				return templateFromList(list);
			},
			// Define your own HTML template format, from either HTML or DOM nodes (which might not be templates!)
			setHtmlFormat(fromHtml, fromElement) {
				templateFromHtml = fromHtml || templateFromHtmlDefault;
				templateFromElement = fromElement || (element => {
					let t = document.createElement('template');
					t.content.appendChild(element);
					return templateFromHtml(t.innerHTML);
				});
			},
			
			bind(endNode, template, innerTemplate) {
				return new SingleValueBind(endNode, template, innerTemplate || template);
			},
			bindComposite(itemFunction, endNode, template, innerTemplate) {
				return new CompositeValueBind(itemFunction, endNode, template, innerTemplate || template);
			}
		},
		
		// TODO: rename to .addTo() ?
		show: (element, data, template, innerTemplate) => {
			if (typeof element == 'string') element = document.querySelector(element);
			if (typeof template != 'function') template = api.template.fromElements(template || 'template');
			return new TrackedDisplay(element, data, template, innerTemplate, false);
		},
		replace: (element, data, template, innerTemplate) => {
			if (typeof element == 'string') element = document.querySelector(element);
			if (!template) template = api.template.fromElement(element);
			return new TrackedDisplay(element, data, template, innerTemplate, true);
		}
	}
	return api;
})();
