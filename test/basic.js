Test("exists", (api, pass, fail) => {
	pass(typeof api == 'object' && api, "exists");
});

//Test("fail", (api, pass, fail) => {
//	fail("immediate failure");
//});
