(new MutationObserver(records => {
	records.forEach(record => {
		if (record.type == "characterData") {
			console.log("text:", record.target.nodeValue);
		} else if (record.type == "attribute") {
			console.log("attr:", record.attributeName, record.target.getAttribute(record.attributeName));
		} else {
			record.addedNodes.forEach(node => {
				console.log("add", node)
			});
			record.removedNodes.forEach(node => console.log("remove", node));
		}
	});
})).observe(document.body, {
	subtree: true,
	childList: true,
	characterData: true
});
