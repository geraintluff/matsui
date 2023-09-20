(attributes => {
	let doubleClickMs = 300;
	function scaleDistance(d, e) {
		if (e.metaKey || e.shiftKey) d *= 0.2;
		return d;
	}
	
	function addKeys(element, keyMaps) {
		if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', 0);
		element.addEventListener('keydown', e => {
			if (keyMaps[e.key]) {
				e.preventDefault();
				e.stopPropagation();
				keyMaps[e.key](e);
			}
		});
	}
	
	attributes.modal = (node, handler) => {
		if (node.tagName !== 'DIALOG') throw Error('Only use $modal on <dialog>');
		node.addEventListener('click', e => {
			let rect = node.getBoundingClientRect();
			var inDialog = rect.top <= event.clientY
				&& event.clientY <= rect.bottom
				&& rect.left <= event.clientX
				&& event.clientX <= rect.right;
			if (e.target === node && !inDialog) node.close();
		});
		return data => {
			let shouldBeOpen = handler(node);
			if (shouldBeOpen && !node.open) {
				node.showModal();
			} else if (!shouldBeOpen && node.open) {
				node.close();
			}
		};
	};

	attributes.press = (node, handler) => {
		let clickCount = 0;
		let prevDown = 0;
		function down() {
			let now = Date.now(), diff = now - prevDown;
			prevDown = now;
			if (diff > doubleClickMs) clickCount = 0;
			handler(++clickCount);
			node.classList.add("interaction-press");
		}
		function up() {
			node.classList.remove("interaction-press");
		}
		node.addEventListener('pointerdown', e => {
			if (e.button) return;
			e.stopPropagation();
			e.preventDefault();
			node.setPointerCapture(e.pointerId);
			down();
		});
		node.addEventListener('pointerup', e => {
			if (!e.button) up();
		});

		node.addEventListener('keydown', e => {
			if (e.key === 'Enter') {
				down();
			}
		});
		node.addEventListener('keyup', e => {
			if (e.key === 'Enter') {
				up();
			}
		});
		node.style.cursor = node.style.cursor || "pointer";
	};
	
	// binds the input's value to some part of the data
	attributes['input-keypath'] = (node, valueFn) => {
		let setValue;
		let isCheckbox = (node.type == 'checkbox');

		node.addEventListener('input', e => {
			if (setValue) {
				if (isCheckbox) {
					setValue(node.checked);
				} else {
					setValue(node.value);
				}
			}
		});
		
		return data => {
			let path = valueFn();
			if (typeof path === 'string') path = path.split('.');
			while (path.length > 1) {
				data = data[path.shift()];
			}
			
			let key = path[0], newValue = data[key];
			if (isCheckbox) {
				node.checked = newValue;
			} else if (node.value != newValue) {
				node.value = newValue;
				node.selectionStart = node.selectionEnd = 0;
			}
			setValue = v => {
				data[key] = v;
			};
		};
	};

	// Enter in <input>, Shift/Meta+Enter in textarea
	attributes['input-done'] = (node, valueFn) => {
		let handler = e => {
			e.preventDefault();
			e.stopPropagation();
			valueFn(node);
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

	attributes['drop-file'] = (node, valueFn) => {
		let accept = node.dataset.accept || '*/*';
		
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
		
		node.addEventListener('dragenter', e => {
			if (getFiles(e)) {
				node.classList.add("interaction-drop");
			}
		});
		node.addEventListener('dragleave', e => {
			if (getFiles(e)) {
				node.classList.remove("interaction-drop");
			}
		});
		node.addEventListener('dragover', e => {
			e.preventDefault();
		});
		node.addEventListener('drop', e => {
			e.preventDefault();
			node.classList.remove("interaction-drop");
			let files = getFiles(e);
			if (files) valueFn(files);
		});
	};

})(Matsui.global.attributes);
