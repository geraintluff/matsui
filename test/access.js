Test("exists", (api, pass, fail) => {
	pass(typeof api == 'object' && api, "exists");
});
