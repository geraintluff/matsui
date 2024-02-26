.SECONDARY: # don't remove intermediate stuff from %-matches

all: release-latest

release-%: release/%/matsui.min.js release/%/matsui.mjs release/%/matsui-bundle.min.js release/%/matsui-bundle.mjs
	@echo "Minified:"
	@for file in release/$*/*.min.js ; do wc -c "$$file" ; gzip -c "$$file" > "$$file.gz"; done
	@echo "Modules:"
	@for file in release/$*/*.mjs ; do wc -c "$$file" ; gzip -c "$$file" > "$$file.gz"; done

	@echo "Gzipped:"
	@for file in release/$*/*.gz ; do wc -c "$$file" ; done
	@rm release/$*/*.gz

release/%/version.js:
	@mkdir -p release/$*
	@echo "Matsui.version = '$*';" > "$$(dirname $@)/version.js"

release/%/matsui.js: matsui.js release/%/version.js
	@cat $^ > $@

release/%/matsui-bundle.js: matsui.js bundle/*.js release/%/version.js
	@cat $^ > $@

%.min.js: %.js
	@cd "$$(dirname $@)" && npx --offline uglify-js "$$(basename $<)" -o "$$(basename $@)" --source-map "url=$$(basename $@).map" \
		--warn --compress passes=10 --mangle --output-opts ascii_only --mangle-props "regex=/^(m_|#)/"

%.mjs: %.js
	@cd "$$(dirname $@)" && npx --offline uglify-js "$$(basename $<)" -o "$$(basename $@)" --source-map "url=$$(basename $@).map" \
		--output-opts "preamble='export default Matsui;'" \
		--warn --compress passes=10 --mangle --output-opts ascii_only --mangle-props "regex=/^(m_|#)/"

publish:
	publish-signalsmith-raw /code/matsui
	publish-signalsmith-git /code/matsui.git