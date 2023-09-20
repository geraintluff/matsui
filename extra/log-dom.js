(new MutationObserver(records => {
	records.forEach(record => {
		if (record.type == "characterData") {
			console.log("text:", record.target.nodeValue);
		} else if (record.type == "attribute") {
			console.log("attr:", record.attributeName, record.target.getAttribute(record.attributeName));
		} else {
			console.log("add", record.addedNodes, "remove", record.removedNodes);
		}
	});
})).observe(document.body, {
	subtree: true,
	childList: true,
	characterData: true
});
