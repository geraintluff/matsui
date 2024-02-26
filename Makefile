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

release/%/matsui.js: matsui.js
	@mkdir -p release/$*
	@echo "Matsui.version = '$*';" > "$$(dirname $@)/version.js"
	@echo "$@: $^"
	@cat $^ "$$(dirname $@)/version.js" > $@

release/%/matsui-bundle.js: matsui.js bundle/*.js
	@mkdir -p release/$*
	@echo "Matsui.version = '$*';" > "$$(dirname $@)/version.js"
	@echo "$@: $^"
	@cat $^ "$$(dirname $@)/version.js" > $@

%.min.js: %.js
	@npx --offline uglify-js --warn --compress passes=10 --mangle --output-opts ascii_only --mangle-props "regex=/^(m_|#)/" -o $@ --source-map "base=$$(dirname $@),url=$$(basename $@).map" -- $<

%.mjs: %.js
	@cp bundle/module/export.js "$$(dirname $*)/export.js"
	@npx --offline uglify-js --warn --compress passes=10 --mangle --output-opts ascii_only --mangle-props "regex=/^(m_|#)/" -o $@ --source-map "base=$$(dirname $@),url=$$(basename $@).map" -- $< "$$(dirname $*)/export.js"

publish:
	publish-signalsmith-raw /code/matsui
	publish-signalsmith-git /code/matsui.git