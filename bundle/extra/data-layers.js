(templateSet => {
	let dataLayerPierceKey = Symbol();
	/* keyFilter can be:
		regex/string/non-object: converted to (k => bool)
		
		
		k =>
			bool: filters keys, and apply the same test to all (data) sub-objects
			
		
	*/
	function dataLayerProxy(data, layerData, keyFilter) {
		if (!data || typeof data !== 'object') return data;
		if (typeof keyFilter !== 'function') {
			let key = keyFilter;
			if (key instanceof RegExp) {
				keyFilter = k => (typeof k === 'string' && key.test(k));
			} else if (key && typeof key === 'object') {
				keyFilter = k => ((Object.hasOwn(key, k) && key[k]) || null);
			} else {
				keyFilter = k => (k == key);
			}
		}
		
		// remove merge/access-tracking
		data = Matsui.merge.withoutHidden(Matsui.access.pierce(data));
		layerData = Matsui.merge.withoutHidden(Matsui.access.pierce(layerData));
		
		return new Proxy(data, {
			get(obj, prop) {
				if (prop == dataLayerPierceKey) return {m_data: data, m_layerData: layerData};
				let filterResult = keyFilter(prop);
				if (filterResult === true) return layerData[prop];
				if (filterResult === false) filterResult = keyFilter;
				let subData = obj[prop];
				if (!subData || typeof subData !== 'object' || !filterResult) return subData;
				if (!(prop in layerData)) layerData[prop] = {};
				return dataLayerProxy(subData, layerData[prop], filterResult);
			},
			set(obj, prop, value) {
				if (keyFilter(prop) === true) {
					layerData[prop] = value;
					return true;
				}
				let layeredValue = value && value[dataLayerPierceKey];
				if (layeredValue) {
					layerData[prop] = layeredValue.m_layerData;
					value = layeredValue.m_data;
				}
				if (prop in layerData) delete layerData[prop]; // overwriting data layer removes the extra layer as well
				return Reflect.set(obj, prop, value);
			},
			deleteProperty(obj, prop) {
				if (prop in layerData) delete layerData[prop];
				return Reflect.deleteProperty(obj, prop);
			}
		});
	}
	
	templateSet.transforms.addProperty = (template, layerKey, templateSet) => {
		return innerTemplate => {
			let binding = template(innerTemplate);
			let combined = Matsui.combineUpdates(binding.updates);

			let latestLayeredData = null;
			let layerData = Matsui.merge.tracked({}, merge => {
				let withMerge = Matsui.merge.addHidden(latestLayeredData, merge);
				combined(withMerge);
			}, true);

			binding.updates = [data => {
				let dataMerge = Matsui.merge.getHidden(data);
				latestLayeredData = dataLayerProxy(data, layerData, layerKey, []);
				let withMerge = Matsui.merge.addHidden(latestLayeredData, dataMerge);
				combined(withMerge);
			}];

			return binding;
		};
	};
})(Matsui.global);
