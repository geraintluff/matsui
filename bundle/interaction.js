Matsui.interaction = (attributes => {
	let doubleClickMs = 300;
	
	attributes['class'] = (node, dataFn) => {
		let prev = '';
		return data => {
			let v = dataFn();
			if (v != prev) {
				(prev + "").split(/\s+/g).forEach(c => {
					if (c) node.classList.remove(c);
				});
				(v + "").split(/\s+/g).forEach(c => {
					if (c) node.classList.add(c);
				});
				prev = v;
			}
		};
	};

	let focusStyle = document.createElement('style');
	focusStyle.textContent = ".interaction-implicit-focus :focus {outline: none;}";
	document.head.appendChild(focusStyle);
	window.addEventListener('pointerdown', e => {
		document.body.classList.add("interaction-implicit-focus");
	}, {capture: true});
	window.addEventListener('keydown', e => {
		if (e.code == 'Tab') {
			document.body.classList.remove("interaction-implicit-focus");
		}
	}, {capture: true});
	window.addEventListener('keydown', e => {
		if (e.code == 'Escape') {
			if (!document.body.classList.contains('interaction-implicit-focus')) {
				document.body.classList.add('interaction-implicit-focus');
			} else {
				e.target.blur();
			}
		}
	});

	function scaleDistance(d, e) {
		if (e.ctrlKey || e.shiftKey) d *= 0.1;
		if (e.metaKey || e.altKey) d = (d > 0) ? Infinity : (d < 0) ? -Infinity : 0;
		return d;
	}
	function isPrimary(e) {
		return !e.ctrlKey && e.button == 0;
	}

	function addKeys(element, downKeys, upKeys) {
		if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', 0);
		element.addEventListener('keydown', e => {
			if (downKeys[e.key]) {
				element.focus();
				e.preventDefault();
				e.stopPropagation();
				downKeys[e.key](e);
			}
		});
		if (upKeys) {
			element.addEventListener('keyup', e => {
				if (upKeys[e.key]) {
					e.preventDefault();
					e.stopPropagation();
					upKeys[e.key](e);
				}
			});
		}
	}

	attributes.value = (node, keyPath, getData) => {
		let isCheckbox = (node.tagName == 'INPUT' && node.type == 'checkbox');
		let isNumeric = (node.tagName == 'INPUT' && (node.type == 'range' || node.type == 'number'));
		if (typeof keyPath == 'string') {
			keyPath = keyPath.split('.');
			let key = keyPath.pop();

			function updateData() {
				let data = getData();
				keyPath.forEach(k => data = data?.[k]);
				if (data) data[key] = (isCheckbox ? node.checked : isNumeric ? parseFloat(node.value) : node.value);
			}
			node.addEventListener('input', updateData);
			node.addEventListener('change', updateData);
			
			return data => {
				keyPath.forEach(k => data = data?.[k]);
				if (data) {
					node.value = data[key];
					if (isCheckbox) node.checked = data[key];
				}
			};
		}
		return data => {
			node.value = keyPath();
		}
	};

	let moveKey = attributes.moveKey = (node, handler) => {
		addKeys(node, {
			ArrowDown: e => handler(0, scaleDistance(15, e), node),
			ArrowUp: e => handler(0, scaleDistance(-15, e), node),
			ArrowLeft: e => handler(scaleDistance(-15, e), 0, node),
			ArrowRight: e => handler(scaleDistance(15, e), 0, node),
			PageDown: e => handler(0, Infinity, node),
			PageUp: e => handler(0, -Infinity, node),
			Home: e => handler(-Infinity, 0, node),
			End: e => handler(Infinity, 0, node)
		});
	};
	
	let supportPointerLock = true;
	attributes.pointerLock = (node, value) => {
		if (supportPointerLock) {
			node._interactionPointerLock = (typeof value === 'function') ? value() : (value == "" || value);
		}
	};

	attributes.move = (node, handler) => {
		node.classList.add("interaction-has-move");
		node.style.touchAction = "none"; // enables dragging on a touch-screen
		
		node.style.cursor = node.style.cursor || "grab";
		let releaseCursor = 'grab';
	
		let prevX, prevY;
		function moveHandler(e) {
			e.preventDefault();
			e.stopPropagation();
			let dx = e.pageX - prevX;
			let dy = e.pageY - prevY;
			if (document.pointerLockElement == node) {
				dx = e.movementX;
				dy = e.movementY;
			}
			prevX = e.pageX;
			prevY = e.pageY;
			handler(scaleDistance(dx, e), scaleDistance(dy, e), node);
		}

		let downCount = 0;
		node.addEventListener('pointerdown', e => {
			node.classList.add("interaction-move");
			if (!isPrimary(e)) return;
			e.preventDefault();
			e.stopPropagation();
			node.focus();
			prevX = e.pageX;
			prevY = e.pageY;
			node.setPointerCapture(e.pointerId);
			if (node._interactionPointerLock) node.requestPointerLock();
			if (++downCount == 1) {
				node.addEventListener("pointermove", moveHandler);
			}
			releaseCursor = node.style.pointer;
		});
		function up(e) {
			node.classList.remove("interaction-move");
			e.preventDefault();
			e.stopPropagation();
			if (document.pointerLockElement == node) document.exitPointerLock();
			if (e.pointerId) node.releasePointerCapture(e.pointerId);
			if (--downCount <= 0) {
				downCount = 0;
				node.removeEventListener("pointermove", moveHandler);
			}
			node.style.pointer = releaseCursor;
		}
		node.addEventListener('pointerup', up);
		node.addEventListener('pointercancel', up);
		node.addEventListener('blur', up);
		
		moveKey(node, handler);
	}

	attributes.scroll = (node, handler) => {
		node.classList.add("interaction-has-scroll");
		// TODO: use keys with Alt/Meta
		node.addEventListener("wheel", e => {
			e.preventDefault();
			e.stopPropagation();
			focus();
			handler(scaleDistance(e.deltaX, e), scaleDistance(e.deltaY, e), node);
		}, {capture: true});
	};
	
	function press(node, handler, includeKeys) {
		node.classList.add("interaction-has-press");
		let clickCount = 0;
		let prevDown = 0;
		let isDown = false;
		let down = e => {
			let now = Date.now(), diff = now - prevDown;
			prevDown = now;
			if (diff > doubleClickMs) clickCount = 0;

			node.classList.add("interaction-press");
			if (!isDown) handler(++clickCount, e, node);
			isDown = true;
			if (e.pointerId) node.setPointerCapture(e.pointerId);
		};
		let up = e => {
			e.preventDefault();
			e.stopPropagation();
			node.classList.remove("interaction-press");
			isDown = false;
			if (e.pointerId) node.releasePointerCapture(e.pointerId);
		};
		if (includeKeys) addKeys(node, {Enter: down, ' ': down}, {Enter: up, ' ': up});
		node.addEventListener('blur', up);
		node.addEventListener('pointerdown', e => {
			if (!isPrimary(e)) return;
			if (includeKeys) { // otherwise, the focus won't cascade to a parent that has key handlers
				e.preventDefault();
				e.stopPropagation();
				node.focus();
			}
			down(e);
		});
		node.addEventListener('pointerup', up);
		node.addEventListener('pointercancel', up);
	};
	attributes.press = (node, handler) => press(node, handler, true);
	attributes.unpress = (node, handler) => {
		node.classList.add("interaction-has-unpress");
		let start = null;
		let down = e => {
			start = Date.now();
			e.preventDefault();
			e.stopPropagation();
			if (e.pointerId) node.setPointerCapture(e.pointerId);
		};
		let up = e => {
			e.preventDefault();
			e.stopPropagation();
			if (start != null) handler(e, (Date.now() - start)*0.001, node);
			start = null;
			if (e.pointerId) node.releasePointerCapture(e.pointerId);
		};
		addKeys(node, {Enter: down}, {Enter: up});
		node.addEventListener('blur', up);
		node.addEventListener('pointerdown', e => {
			if (!isPrimary(e)) return;
			node.focus();
			down(e);
		});
		node.addEventListener('pointerup', up);
	};
	attributes.click = (node, handler) => {
		let clickCount = 0;
		let prevDown = 0;
		node.addEventListener('click', e => {
			let now = Date.now(), diff = now - prevDown;
			prevDown = now;
			if (diff > doubleClickMs) clickCount = 0;
			handler(++clickCount, e, node);
		});
	};

	attributes['delete'] = (node, handler) => {
		node.addEventListener('keydown', e => {
			if (e.code == 'Delete' || e.code == 'Backspace') {
				e.preventDefault();
				e.stopPropagation();
				handler(e, node);
			}
		});
	};

	// Enter in <input>, Shift/Meta+Enter in textarea
	attributes.done = (node, valueFn) => {
		let handler = e => {
			e.preventDefault();
			e.stopPropagation();
			valueFn(node.value, node);
		};
		
		let multiline = (node.tagName === 'TEXTAREA');
		if (!multiline && !node.hasAttribute('enterkeyhint')) {
			node.setAttribute('enterkeyhint', 'done');
		}
		node.addEventListener('keydown', e => {
			if (e.key == 'Enter') {
				if (!multiline || e.metaKey || e.shiftKey) handler(e);
			}
		});
	};
	
	attributes.clipboard = (node, value) => {
		node.classList.add("interaction-has-clipboard");
		return attributes.press(node, _ => {
			let text = value ? (typeof value == 'function' ? value(node) : value) : node.textContent;
			navigator.clipboard.writeText(text);
			node.classList.remove("interaction-clipboard");
			node.classList.add("interaction-clipboard");
			setTimeout(() => {
				node.classList.remove("interaction-clipboard");
			}, 1000);
		});
	};

	attributes.dropFileIf = (node, valueFn) => {
		node._interactionDropIfHandler = valueFn;
	};

	attributes.dropFile = (node, valueFn) => {
		node.classList.add("interaction-has-drop");
		if (valueFn == "") {
			// walk up the tree until we find an actual handler
			valueFn = files => {
				let n = node.parentNode;
				while (n) {
					if (n._interactionDropHandler) {
						n._interactionDropHandler(files);
						return;
					}
					n = n.parentNode;
				}
			};
		}
		node._interactionDropHandler = valueFn;
		let acceptFiles = node._interactionDropIfHandler || (x => true);
	
		function getFiles(e) {
			let files = [];
			if (e.dataTransfer.items) {
				[...e.dataTransfer.items].forEach(item => {
					// If dropped items aren't files, reject them
					if (item.kind === "file") {
						files.push(item.getAsFile());
					}
				});
			} else {
				files = [...e.dataTransfer.files];
			}
			return files.length && files;
		}
		
		let currentDragTarget = null;
		node.addEventListener('dragenter', e => {
			currentDragTarget = e.target;
			let files = getFiles(e);
			if (files && acceptFiles(files, e)) {
				node.classList.add("interaction-drop");
				e.preventDefault();
				e.stopPropagation();
			}
		});
		node.addEventListener('dragleave', e => {
			// the drag enters a new element before leaving the previous one
			if (e.target === currentDragTarget) {
				node.classList.remove("interaction-drop");
			}
		});
		node.addEventListener('dragover', e => {
			e.preventDefault();
			let files = getFiles(e);
			if (!files || !acceptFiles(files, e)) {
				node.classList.remove("interaction-drop");
			}
		});
		node.addEventListener('drop', e => {
			let files = getFiles(e);
			node.classList.remove("interaction-drop");
			document.querySelectorAll('.interaction-drop').forEach(n => {
				n.classList.remove("interaction-drop");
			});
			if (files && acceptFiles(files, e)) {
				e.preventDefault();
				e.stopPropagation();
				valueFn(files);
			}
		});
		if (node.tagName == 'INPUT' && node.type == 'file') {
			node.addEventListener('change', e => {
				e.preventDefault();
				let files = [].slice.call(node.files, 0);
				if (files.length && files && acceptFiles(files, e)) {
					valueFn(files);
				}
			});
		}
	};

	attributes.dialogWhen = (node, handler) => {
		if (node.tagName !== 'DIALOG') throw Error("only use $dialog-when on <dialog>");

		// these can be closed on their own, not by touching the state - so log an error if we don't have a handler to keep it in line
		function checkForCloseHandler() {
			if (!node._interactionHasDialogClose) console.error("<dialog> closed with no $dialog-close to align the state")
		}
		node.addEventListener('close', checkForCloseHandler);
		node.addEventListener('cancel', checkForCloseHandler);

		// close by clicking outside the dialog
		node.addEventListener('click', e => {
			let rect = node.getBoundingClientRect();
			var inDialog = rect.top <= event.clientY
				&& event.clientY <= rect.bottom
				&& rect.left <= event.clientX
				&& event.clientX <= rect.right;
			if (e.target === node && !inDialog) {
				node.close();
			}
		}, {capture: true});
		return data => {
			let shouldBeOpen = typeof handler == 'function' ? handler(node) : handler;
			if (shouldBeOpen && !node.open) {
				node.showModal();
			} else if (!shouldBeOpen && node.open) {
				node.close();
			}
		};
	};
	// So you can keep the state in line when a <dialog> element is manually closed
	attributes.dialogClose = (node, handler) => {
		node._interactionHasDialogClose = true;
		node.addEventListener('close', e => handler(node));
		node.addEventListener('cancel', e => handler(node));
	};
	
	return {
		keys: addKeys
	};
})(Matsui.global.attributes);
