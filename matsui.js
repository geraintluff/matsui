let Matsui = (() => {
	let isObject = data => (data && typeof data === 'object');

	let accessTrackingMap = new WeakMap();
	function trackAccess(data, leafAccessFn, keyPath) {
		let proxy = new Proxy(data, {
			get(obj, prop) {
				let value = Reflect.get(...arguments);
				let subPath = keyPath.concat(prop);
				if (isObject(value)) {
					return trackAccess(value, leafAccessFn, subPath);
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
	function getUntracked(data) {
		let entry = accessTrackingMap.get(data);
		if (entry) {
			entry.accessFn(entry.keyPath);
			return entry.data;
		}
		return data;
	}

	let hiddenMergeMap = new WeakMap();
	let noChangeSymbol = Symbol("no change");
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
		return hiddenMergeMap.get(data);
	}

	let updateTriggerSetKey = Symbol('updateFunctions');
	function combineUpdatesWithTracking(updateFunctions) {
		let currentUpdateIndex = null;
		let updateTriggers;
		// Whenever a property in our data tree is accessed during a render update, we stick that update in a parallel tree structure
		let makeTracked = data => {
			if (!isObject(data)) return data;
			return trackAccess(data, keyPath => {
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
			
			updateSet.forEach(index => { // TODO: sort this, so that they're always run in the order provided, which would let us eagerly check template compatibility but only sometimes
				currentUpdateIndex = index;
				updateFunctions[index](tracked);
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
				let untracked = getUntracked(data); // if this is being called from inside a DataTemplateBinding, terminate the access tracking here

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
			let untracked = getUntracked(data); // terminate any access tracking here (so we get notified for everything)
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
					let itemEndNode = document.createTextNode("");
					endNode.before(itemEndNode);

					let index = arrayBinds.length;
					let item = itemFn(index, untracked[index]);
					let bind = new SingleValueBind(itemEndNode, template, innerTemplate);
					arrayBinds.push(bind);
					bind.update(item);
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
						let item = itemFn(key, data[key]);
						objectBinds[key].update(item);
					} else if (Object.hasOwn(mergeValue, key)) {
						let item = itemFn(key, data[key]);
						objectBinds[key].update(item);
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

	/* scans a cloneable node tree, and adds setup functions to the nodeSetupList array */
	function scanElementTemplate(node, nodeSetupList, scopedTemplates, nodePath) {
		if (!node.childNodes) return;

		// TODO: collect and turn them into a single inline `<script>` at the top level
		Array.from(node.childNodes).forEach(child => {
			if (child.tagName == "SCRIPT" && child.hasAttribute("@setup")) {
				let runScript = new Function("state", child.textContent);
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
				if (child.hasAttribute("@items")) { // turn this element into a template and use it for items (using this item expression)
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
						let scopedItemTemplate = t => {
							if (t !== "debug") throw Error("DEBUG");
							return itemTemplate(scopedTemplate);
						}
						let bind = new CompositeValueBind(itemFn, endNode, scopedItemTemplate, "debug");
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
							if (valueExpr[0] == '>') valueExpr = "state =" + valueExpr
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
	let templateFromElement = element => {
		let cloneable = element.content || element;
		let setupFunctions = [];
		scanElementTemplate(cloneable, setupFunctions, [], []);

		let result = innerTemplate => {
			let node = cloneable.cloneNode(true);
			let updates = [];
			setupFunctions.forEach(fn => {
				let update = fn(node, innerTemplate);
				if (update) updates.push(update);
			});
			return {node: node, updates: updates};
		};
		let filterExpr = element.getAttribute && element.getAttribute("@filter");
		result.filter = new Function('state', 'return ' + (filterExpr || 'true'));
		return result;
	};
	function templateFromHtml(html) {
		let template = document.createElement("template");
		template.innerHTML = html;
		return templateFromElement(template);
	}

	function makeMergeValue(fromValue, toValue) {
		if (!isObject(toValue) || !isObject(fromValue)) return toValue;
		if (Array.isArray(toValue)) return toValue;

		let obj = {};
		Object.keys(toValue).forEach(key => {
			if (Object.hasOwn(fromValue, key)) {
				obj[key] = makeMergeValue(fromValue[key], toValue[key]);
			} else {
				obj[key] = toValue[key];
			}
		});
		Object.keys(fromValue).forEach(key => {
			if (!Object.hasOwn(toValue, key)) {
				obj[key] = null;
			}
		});
		return obj;
	}
	function applyMerge(value, mergeObj) {
		// simple types are just overwritten
		if (!isObject(value) || !isObject(mergeObj)) return mergeObj;
		// Arrays overwrite everything
		if (Array.isArray(mergeObj)) return mergeObj;

		// They're both objects: mergey-merge
		Object.keys(mergeObj).forEach(key => {
			let mergeValue = mergeObj[key];
			if (Object.hasOwn(value, key)) {
				if (mergeValue == null) {
					delete value[key];
					return;
				}
				let previous = value[key];
				let replacement = applyMerge(previous, mergeValue);
				if (typeof previous != 'object' || typeof replacement != 'object' || replacement != previous) {
					value[key] = replacement;
				}
			} else if (mergeValue != null) {
				value[key] = mergeValue;
			}
		});
		return value;
	}
		
	// Wraps an object so that it notifies you (with a merge) every time it's changed
	function mergeNotificationObject(data, updateFn, keyPath) {
		if (!isObject(data)) return data;
		return new Proxy(data, {
			get(obj, prop) {
				let value = Reflect.get(...arguments);
				if (isObject(value)) {
					return mergeNotificationObject(value, updateFn, keyPath.concat(prop));
				}
				return value;
			},
			set(obj, prop, value, proxy) {
				if (value == null) return Reflect.deleteProperty(proxy, prop);
				let oldValue = Reflect.get(obj, prop);
				if (Reflect.set(obj, prop, value)) {
					let merge = {[prop]: makeMergeValue(oldValue, value)};
					updateFn(merge, keyPath);
					return true;
				}
				return false;
			},
			deleteProperty(obj, prop) {
				if (Reflect.deleteProperty(obj, prop)) {
					updateFn({[prop]: null}, keyPath);
					return true;
				}
				return false;
			}
		});
	}

	function Mergeable(host, data, updateFn, template) {
		let pendingMerge = null, pendingMergeTimeout = null;
		let notifyPendingMerge = () => {
			clearTimeout(pendingMergeTimeout);
			if (pendingMerge) {
				if (updateFn) updateFn(pendingMerge);
				this.notifyMerged(pendingMerge);
				pendingMerge = null;
			}
		}
		let makeMonitored = data => {
			// Assembles a JSON Patch Merge for any observed changes, and calls .notifyMerged()
			return mergeNotificationObject(data, (mergeObj, keyPath) => {
				for (let i = keyPath.length - 1; i >= 0; --i) {
					let key = keyPath[i];
					mergeObj = {[key]: mergeObj};
				}
				
				if (pendingMerge) { // collect multiple changes together
					pendingMerge = applyMerge(pendingMerge, mergeObj);
				} else {
					pendingMerge = mergeObj;
					requestAnimationFrame(notifyPendingMerge);
					pendingMergeTimeout = setTimeout(notifyPendingMerge, 0);
				}
			}, []);
		}
		let monitored = makeMonitored(data);

		let endNode = document.createTextNode("");
		host.append(endNode);
		let bind = new SingleValueBind(endNode, template, template);
		bind.update(monitored);

		this.notifyMerged = mergeObj => {
			let withHiddenMerge = addHiddenMerge(monitored, mergeObj);
			bind.update(withHiddenMerge);
		};

		this.merge = mergeObj => {
			let newData = applyMerge(data, mergeObj);
			if (newData != data) {
				data = newData;
				monitored = makeMonitored(data);
			}
			this.notifyMerged(mergeObj);
		};
		
		this.replace = newData => {
			let mergeValue = makeMergeValue(data, newData);
			data = newData;
			monitored = makeMonitored(data);
			this.notifyMerged(mergeValue);
		};
	}
	
	let templateCacheSymbol = Symbol("template");
	function collectElementTemplates(element) {
		let templateList = [];
		element.querySelectorAll('template').forEach(template => {
			let t = template[templateCacheSymbol]; // we have to cache it because the parse messes with the tree
			if (!t) {
				t = templateFromElement(template, template.content);
				if (template.id) t.id = template.id;
				template[templateCacheSymbol] = t;
			}
			templateList.push(t);
		});
		return templateList;
	}

	let fallbackTemplate = templateFromHtml(`<template @filter="Array.isArray(state)"><details><summary>[{{=a=>a.length}} items]</summary><ol><li @items="(k,v)=>[v]">{{0}}</li></ol></details></template><template><details @items="(k,v)=>[k,v]" style="width:100%;box-sizing:border-box;font-size:0.8rem;line-height:1.2"><summary style="opacity:0.75;font-style:italic;cursor:pointer">{{0}}</summary><div style="margin-inline-start:2em;margin-inline-start:calc(min(4em,10%))">{{1}}</div></details></template>{{=}}`);
	function templateFromList(list, fallback) {
		if (!fallback) fallback = fallbackTemplate;
		
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
				currentTemplate = fallback;
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

	let api = {
		templates: element => {
			if (typeof element == 'string') element = document.querySelector(element);
			return templateFromList(collectElementTemplates(element));
		},
		fill: (element, data, updateFn, template) => {
			if (typeof template != 'function') template = api.templates(template || document);
			return new Mergeable(element, data, updateFn, template);
		}
	}
	return api;
})();
