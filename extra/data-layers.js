(templateSet => {
	let dataLayerPierceKey = Symbol();
	function dataLayerProxy(data, layerData, keyFilter, singleLayer) {
		if (!data || typeof data !== 'object') return data;
		if (typeof keyFilter !== 'function') {
			let key = keyFilter;
			if (keyFilter instanceof RegExp) {
				keyFilter = k => (typeof k === 'string' && key.test(k));
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
				if (keyFilter(prop)) return layerData[prop];
				let subData = obj[prop];
				if (!subData || typeof subData !== 'object') return subData;
				if (!(prop in layerData)) layerData[prop] = {};
				return singleLayer ? subData : dataLayerProxy(subData, layerData[prop], keyFilter);
			},
			set(obj, prop, value) {
				let layeredValue = value && value[dataLayerPierceKey];
				if (layeredValue) {
					layerData[prop] = layeredValue.m_layerData;
					value = layeredValue.m_data;
				}
				if (keyFilter(prop)) {
					layerData[prop] = value;
					return true;
				}
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
				latestLayeredData = dataLayerProxy(data, layerData, layerKey);
				let withMerge = Matsui.merge.addHidden(latestLayeredData, dataMerge);
				combined(withMerge);
			}];

			return binding;
		};
	};
})(Matsui.global);
