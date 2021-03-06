const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const Funnel = require('broccoli-funnel');
const MergeTrees = require('broccoli-merge-trees');
const SVGOptimizer = require('broccoli-svg-optimizer');
const Symbolizer = require('broccoli-symbolizer');
const InlinePacker = require('./inline-packer');
const ViewerAssetsBuilder = require('./viewer-assets-builder');
const ViewerBuilder = require('./viewer-builder');
const validateOptions = require('./validate-options');
const defaultGenerators = require('./default-generators');

// GLOBAL_OPTIONS can be defined as both a root or strategy specific option.
const GLOBAL_OPTIONS = ['sourceDirs', 'stripPath', 'optimizer'];

const symbolsLoaderScript = fs.readFileSync(
  path.join(__dirname, '../symbols-loader.html'), 'utf8'
);

function mergeTreesIfNeeded(trees, options) {
  return trees.length === 1 ? trees[0] : new MergeTrees(trees, options);
}

module.exports = {
  name: 'ember-svg-jar',

  isDevelopingAddon() {
    return false;
  },

  included(app) {
    this._super.included.apply(this, arguments);

    // see: https://github.com/ember-cli/ember-cli/issues/3718
    if (typeof app.import !== 'function' && app.app) {
      // eslint-disable-next-line no-param-reassign
      app = app.app;
    }

    this.initializeOptions(app.options.svgJar, app.env);
  },

  treeForPublic() {
    let trees = [];

    if (this.options.viewer.enabled) {
      trees.push(this.getViewerTree());

      if (this.options.viewer.embed) {
        trees.push(this._super.treeForPublic.apply(this, arguments));
      }
    }

    if (this.hasSymbolStrategy()) {
      trees.push(this.getSymbolStrategyTree());
    }

    return mergeTreesIfNeeded(trees);
  },

  treeForApp(appTree) {
    let trees = [appTree];

    if (this.hasInlineStrategy()) {
      trees.push(this.getInlineStrategyTree());
    }

    return mergeTreesIfNeeded(trees, { overwrite: true });
  },

  contentFor(type) {
    let includeLoader =
        this.hasSymbolStrategy() && this.optionFor('symbol', 'includeLoader');

    if (type === 'body' && includeLoader) {
      return symbolsLoaderScript
        .replace('{{FILE_PATH}}', this.optionFor('symbol', 'outputFile'));
    }

    return '';
  },

  initializeOptions(options, env) {
    this.options = _.merge({
      sourceDirs: ['public'],
      strategy: 'inline',
      stripPath: true,
      optimizer: {},
      persist: true,

      viewer: {
        enabled: env === 'development',
        embed: env === 'development'
      },

      inline: {
        idGen: defaultGenerators.inlineIdGen,
        copypastaGen: defaultGenerators.inlineCopypastaGen
      },

      symbol: {
        idGen: defaultGenerators.symbolIdGen,
        copypastaGen: defaultGenerators.symbolCopypastaGen,
        outputFile: '/assets/symbols.svg',
        prefix: '',
        includeLoader: true
      }
    }, options || {});

    validateOptions(this.options);
    this.options.strategy = _.castArray(this.options.strategy);
  },

  optionFor(strategy, optionName) {
    return _.isUndefined(this.options[strategy][optionName])
      ? GLOBAL_OPTIONS.indexOf(optionName) !== -1 && this.options[optionName]
      : this.options[strategy][optionName];
  },

  sourceDirsFor(strategy) {
    return this.optionFor(strategy, 'sourceDirs')
      .filter((sourceDir) => fs.existsSync(sourceDir));
  },

  svgFilesFor(strategy) {
    this.svgFilesCache = this.svgFilesCache || {};

    if (this.svgFilesCache[strategy]) {
      return this.svgFilesCache[strategy];
    }

    let sourceDirs = this.sourceDirsFor(strategy);
    let svgFiles = new Funnel(mergeTreesIfNeeded(sourceDirs), {
      include: ['**/*.svg']
    });

    let svgoConfig = this.optionFor(strategy, 'optimizer');
    if (svgoConfig) {
      svgFiles = new SVGOptimizer(svgFiles, {
        svgoConfig,
        persist: this.options.persist
      });
    }

    this.svgFilesCache[strategy] = svgFiles;

    return svgFiles;
  },

  originalSvgFilesFor(strategy) {
    let sourceDirs = this.sourceDirsFor(strategy);

    return new Funnel(mergeTreesIfNeeded(sourceDirs), {
      include: ['**/*.svg'],
      destDir: '__original__'
    });
  },

  getViewerTree() {
    let idGenOpts = {
      symbol: {
        prefix: this.optionFor('symbol', 'prefix')
      }
    };

    let viewerBuilderNodes = this.options.strategy.map((strategy) => {
      let inputNode = new MergeTrees([
        this.svgFilesFor(strategy),
        this.originalSvgFilesFor(strategy)
      ]);

      return new ViewerAssetsBuilder(inputNode, {
        strategy,
        idGen: this.optionFor(strategy, 'idGen'),
        idGenOpts: idGenOpts[strategy],
        copypastaGen: this.optionFor(strategy, 'copypastaGen'),
        stripPath: this.optionFor(strategy, 'stripPath'),
        outputFile: `${strategy}.json`,
        ui: this.ui
      });
    });

    return new ViewerBuilder(mergeTreesIfNeeded(viewerBuilderNodes), {
      outputFile: 'svg-jar.json',
      hasManyStrategies: this.options.strategy.length > 1
    });
  },

  getInlineStrategyTree() {
    return new InlinePacker(this.svgFilesFor('inline'), {
      idGen: this.optionFor('inline', 'idGen'),
      stripPath: this.optionFor('inline', 'stripPath'),
      outputFile: 'inline-assets.js'
    });
  },

  getSymbolStrategyTree() {
    return new Symbolizer(this.svgFilesFor('symbol'), {
      idGen: this.optionFor('symbol', 'idGen'),
      stripPath: this.optionFor('symbol', 'stripPath'),
      outputFile: this.optionFor('symbol', 'outputFile'),
      prefix: this.optionFor('symbol', 'prefix'),
      persist: this.options.persist
    });
  },

  hasInlineStrategy() {
    return this.options.strategy.indexOf('inline') !== -1;
  },

  hasSymbolStrategy() {
    return this.options.strategy.indexOf('symbol') !== -1;
  }
};
