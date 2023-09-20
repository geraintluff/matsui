Matsui.global.attributes['input-keypath'] = (node, valueFn) => {
	let setValue;

	node.addEventListener('input', e => {
		if (setValue) {
			setValue(node.value);
		}
	});
	
	return data => {
		let path = valueFn();
		if (typeof path === 'string') path = path.split('.');
		
		while (path.length > 1) {
			data = data[path.shift()];
		}
		let key = path[0];
		if (node.value != data[key]) {
			node.value = data[key];
			node.selectionStart = node.selectionEnd = 0;
		}
		setValue = v => {
			data[key] = v;
		};
	};
};

Matsui.global.attributes['shift-press'] = (node, valueFn) => {
	let handler = e => {
		if (e.metaKey || e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			valueFn(node);
		}
	};
	
	node.addEventListener('keydown', e => {
		if (e.key == 'Enter') handler(e);
	});
	node.addEventListener('click', handler);
};

Matsui.global.attributes['drop-file'] = (node, valueFn) => {
	let accept = node.dataset.accept || '*/*';
	
	node.addEventListener('dragover', e => {
		e.preventDefault();
	});
	node.addEventListener('drop', e => {
		e.preventDefault();
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
		valueFn(files);
	});
};
