"use strict"
let Matsui = (() => {
	let isObject = data => (data && typeof data === 'object');

	/*--- JSON Patch Merge stuff ---*/

	// Attach a hidden merge to data, which use later to decide what to re-render
	let hiddenMergeKey = Symbol();
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
		tracked(data, updateFn) {
			if (!isObject(data)) return data;
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
		// collects multiple changes together
		trackedAsync(data, updateFn) {
			let pendingMerge = null, pendingMergeTimeout = null;
			let notifyPendingMerge = () => {
				clearTimeout(pendingMergeTimeout);
				if (pendingMerge) {
					updateFn(pendingMerge);
					pendingMerge = null;
				}
			}
			return merge.tracked(data, mergeObj => {
				if (pendingMerge) {
					pendingMerge = merge.apply(pendingMerge, mergeObj, true); // keep nulls because they're meaningful
				} else {
					pendingMerge = mergeObj;
					requestAnimationFrame(notifyPendingMerge);
					clearTimeout(pendingMergeTimeout);
					pendingMergeTimeout = setTimeout(notifyPendingMerge, 0);
				}
			});
		},
		addHidden(data, mergeObj) {
			if (!isObject(data)) return data;
			return new Proxy(data, {
				get(obj, prop) {
					if (prop == hiddenMergeKey) return mergeObj;
					let value = Reflect.get(...arguments);
					let hasChange = isObject(mergeObj) && (prop in mergeObj);
					return merge.addHidden(value, hasChange ? mergeObj[prop] : noChangeSymbol);
				}
			});
		},
		getHidden(data, noChange) {
			let mergeObj = data[hiddenMergeKey];
			if (mergeObj === noChangeSymbol) return noChange;
			return (typeof mergeObj == 'undefined') ? data : mergeObj;
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
			let mergeValue = merge.getHidden(data);
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
	
	function templateFromIds(ids) {
		let result = (t => t(t)); // Functional programming, babeeeyy
		while (ids.length) {
			let outerId = ids.pop();
			let outerTemplate = template[outerId]; // hack for now, until we have a template registry
			//console.log(outerId, outerTemplate);
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
	let template = {
		text(innerTemplate) {
			let textNode = document.createTextNode("");
			return {
				node: textNode,
				updates: [data => {
					if (isObject(data)) data = JSON.stringify(data);
					textNode.nodeValue = (data == null) ? "" : data;
				}]
			};
		},
		list(innerTemplate) {
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
					data = access.pierce(data); // stop access-tracking here, so individual keys/items don't end up in the access-tracking map
					
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
							let binding = innerTemplate(innerTemplate);
							endSep.before(binding.node);
							updateList.push(combineUpdates(binding.updates));
						}
						// update everything
						updateList.forEach((update, index) => {
							update(data[index]);
						});
					} else if (isObject(data)) {
						throw Error("not implemented yet");
					} else {
						clear();
					}
				}]
			};
		},
		fromElementPlaceholders(element, placeholderMap, placeholderRegex) {
			let cloneable = element.content || element;
			let setup = [];
			
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
				let updates = [];
				setup.forEach((obj, index) => {
					obj.fn(subNodes[index], updates, innerTemplate);
				});
				
				return {
					node: node,
					updates: updates
				};
			};
		},
		fromElement(element) {
			let placeholderMap = {};
			let placeholderIndex = 0;

			let replaceString = text => text.replace(/((\$[a-z_-]+)*)(\$?)\{([^\{\}]*)\}/ig, (all, prefix, _, $, match) => {
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
					template: templateFromIds(prefix.split('$').slice(1)),
					value: value
				};
				return placeholder;
			});
			
			function walk(node) {
				if (node.nodeType === 1) { // element
					if (node.hasAttribute('@raw')) return;
				} else if (node.nodeType === 3) { // text
					node.nodeValue = replaceString(node.nodeValue);
				}
				if (node.childNodes) {
					node.childNodes.forEach(walk);
				}
			}
			walk(element.content || element);
			return template.fromElementPlaceholders(element, placeholderMap, placeholderRegex);
		},
		tagged(strings, ...values) {
			let placeholderMap = {};
			let placeholderIndex = 0;
			
			let replaceString = text => text.replace(/((\$[a-z_-]+)*){([^\{\}]*)\}/ig, (all, prefixes, _, key) => {
				let placeholder = placeholderPrefix + (++placeholderIndex) + placeholderSuffix;
				let value = (data => isObject(data) ? data[match] : null);
				placeholderMap[placeholder] = {
					template: templateFromIds(prefixes.split('$').slice(1)),
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
					entry.template = templateFromIds(prefixes.split('$').slice(1));
					return "";
				});
				placeholderMap[placeholder] = entry;
				parts.push(placeholder);
				
				parts.push(replaceString(strings[i + 1]));
			}
			
			let element = document.createElement('template');
			element.innerHTML = parts.join("");
			return template.fromElementPlaceholders(element, placeholderMap, placeholderRegex);
		}
	};

	//------------------------------------------------------------------------
	
	let fallbackTemplate = template.text//templateFromHtml(`<template @filter="Array.isArray(data)"><details><summary>[{{=a=>a.length}} items]</summary><ol><li @items="(k,v)=>[v]">{{0}}</li></ol></details></template><template><details @items="(k,v)=>[k,v]" style="width:100%;box-sizing:border-box;font-size:0.8rem;line-height:1.2"><summary style="opacity:0.75;font-style:italic;cursor:pointer">{{0}}</summary><div style="margin-inline-start:2em;margin-inline-start:calc(min(4em,10%))">{{1}}</div></details></template>{{=}}`);
	function templateFromList(list) {
		let listTemplate = innerTemplate => {
			let node = document.createDocumentFragment();
			let startNode = document.createTextNode("");
			let endNode = document.createTextNode("");
			node.append(startNode, endNode);
			
			let currentTemplate, currentUpdates;
			
			function update(data) {
				if (currentTemplate) {
					if (!currentTemplate.filter || currentTemplate.filter(data)) { // still OK to render this data
						return currentUpdates.forEach(fn => fn(data));
					}
				}
				// Clear the previous render
				while (startNode.nextSibling && startNode.nextSibling != endNode) {
					startNode.nextSibling.remove();
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
				let binding = currentTemplate(listTemplate);
				startNode.after(binding.node);
				currentUpdates = binding.updates;
			}

			return {node: node, updates: [update]};
		};
		return listTemplate;
	}

	function TrackedRender(data) {
		let updateFunctions = [];
		let sendUpdate = mergeObj => {
			let withMerge = merge.addHidden(data, mergeObj);
			updateFunctions.forEach(fn => fn(withMerge));
		};
		// Register for merge updates
		this.track = fn => {
			updateFunctions.push(fn);
			return this;
		};

		let mergeTracked;
		let setData = newData => {
			data = newData;
			mergeTracked = merge.trackedAsync(data, sendUpdate);
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
		
		function addBinding(host, template, innerTemplate) {
			let bindingInfo = template(innerTemplate || fallbackTemplate);
			let updateDisplay = combineUpdates(bindingInfo.updates);

			// Update the display straight away
			updateDisplay(mergeTracked, data);
			// and update on future data as well
			updateFunctions.push(updateDisplay);
			
			return bindingInfo.node;
		}
		this.addTo = (element, template, innerTemplate) => {
			let node = addBinding(element, template, innerTemplate);
			element.append(node);
			return this;
		}
		this.replace = (element, template, innerTemplate) => {
			let node = addBinding(element, template, innerTemplate);
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
		template: template,

		wrap: data => new TrackedRender(data),
		html: template.tagged, // for convenience
		
		// TODO: rename to .addTo() ?
		show: (element, data, template, innerTemplate) => {
			if (typeof element === 'string') element = document.querySelector(element);
			if (typeof template !== 'function') template = api.oldTemplate.fromElements(template || 'template');
			let render = new TrackedRender(data);
			render.addTo(element, template, innerTemplate);
			return render;
		},
		replace: (element, data, template, innerTemplate) => {
			if (typeof element === 'string') element = document.querySelector(element);
			if (!template) template = api.template.fromElement(element);
			let render = new TrackedRender(data);
			render.replace(element, template, innerTemplate);
			return render;
		}
	}
	return api;
})();
