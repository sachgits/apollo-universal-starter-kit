import webpack from 'webpack';
import ManifestPlugin from 'webpack-manifest-plugin';
import ExtractTextPlugin from 'extract-text-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import merge from 'webpack-merge';
import nodeExternals from 'webpack-node-externals';
import path from 'path';
import PersistGraphQLPlugin from 'persistgraphql-webpack-plugin';
import _ from 'lodash';
import AssetResolver from 'haul-cli/src/resolvers/AssetResolver';
import HasteResolver from 'haul-cli/src/resolvers/HasteResolver';

const appConfigs = require('./webpack.app_config');
const pkg = require('../package.json');

const IS_TEST = process.argv[1].indexOf('mocha-webpack') >= 0;
if (IS_TEST) {
  delete appConfigs.serverConfig.url;
}
const IS_SSR = pkg.app.ssr && !appConfigs.serverConfig.url && !IS_TEST;
const IS_PERSIST_GQL = pkg.app.persistGraphQL && !appConfigs.serverConfig.url && !IS_TEST;
global.__DEV__ = process.argv.length >= 3 && (process.argv[2].indexOf('watch') >= 0 || IS_TEST);
const buildNodeEnv = __DEV__ ? (IS_TEST ? 'test' : 'development') : 'production';

const moduleName = path.resolve('node_modules/persisted_queries.json');
let clientPersistPlugin, serverPersistPlugin;
if (IS_PERSIST_GQL) {
  clientPersistPlugin = new PersistGraphQLPlugin({ moduleName,
    filename: 'extracted_queries.json', addTypename: true });
  serverPersistPlugin = new PersistGraphQLPlugin({ moduleName,
    provider: clientPersistPlugin });
} else {
  // Dummy plugin instances just to create persisted_queries.json virtual module
  clientPersistPlugin = new PersistGraphQLPlugin({ moduleName });
  serverPersistPlugin = new PersistGraphQLPlugin({ moduleName });
}

let basePlugins = [];

if (__DEV__) {
  basePlugins.push(new webpack.NamedModulesPlugin());
} else {
  basePlugins.push(new webpack.optimize.UglifyJsPlugin({ minimize: true }));
  basePlugins.push(new webpack.LoaderOptionsPlugin({ minimize: true }));
}

const createBaseConfig = platform => {
  const baseConfig = {
    module: {
      rules: [
        {
          test: /\.jsx?$/,
          exclude: /(node_modules|bower_components)/,
          use: [{
            loader: 'babel-loader',
            options: {
              cacheDirectory: __DEV__,
              presets: ["react", ["es2015", { "modules": false }], "stage-0"],
              plugins: [
                "transform-runtime",
                "transform-decorators-legacy",
                "transform-class-properties",
                ["styled-components", { "ssr": IS_SSR } ]
              ].concat(__DEV__ && pkg.app.reactHotLoader ? ['react-hot-loader/babel'] : []),
              only: ["*.js", "*.jsx"]
            }
          }].concat(
            IS_PERSIST_GQL ?
              ['persistgraphql-webpack-plugin/js-loader'] : []
          )
        },
        {
          test: /\.graphqls/,
          use: 'raw-loader'
        },
        {
          test: /\.(graphql|gql)$/,
          exclude: /node_modules/,
          use: ['graphql-tag/loader'].concat(
            IS_PERSIST_GQL ?
              ['persistgraphql-webpack-plugin/graphql-loader'] : []
          )
        },
        {
          test: /\.(png|ico|jpg|xml)$/,
          use: 'url-loader?name=[hash].[ext]&limit=10000'
        },
        {
          test: /\.woff(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          use: 'url-loader?name=./assets/[hash].[ext]&limit=10000'
        },
        {
          test: /\.(ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          use: 'file-loader?name=./assets/[hash].[ext]'
        },
      ]
    },
    resolve: {
      modules: [path.join(__dirname, '../src'), 'node_modules'],
      extensions: [`.${platform}.js`, `.${platform}.jsx`, '.js', '.jsx']
    },
    plugins: basePlugins,
    watchOptions: {
      ignored: /build/
    },
    bail: !__DEV__
  };

  if (['android', 'ios'].indexOf(platform) < 0) {
    baseConfig.resolve.alias = {
      'react-native': 'react-native-web'
    };
  }

  return baseConfig;
};

let serverPlugins = [
  new webpack.BannerPlugin({
    banner: 'require("source-map-support").install();',
    raw: true, entryOnly: false
  }),
  new webpack.DefinePlugin(Object.assign({
    __CLIENT__: false, __SERVER__: true, __SSR__: IS_SSR,
    __DEV__: __DEV__, 'process.env.NODE_ENV': `"${buildNodeEnv}"`,
    __PERSIST_GQL__: IS_PERSIST_GQL
  })),
  serverPersistPlugin
];

const nodeExternalsFn = nodeExternals({
  whitelist: [/(^webpack|^react-native)/]
});

const serverConfig = merge.smart(_.cloneDeep(createBaseConfig("web")), {
  name: 'backend',
  devtool: __DEV__ ? '#cheap-module-source-map' : '#source-map',
  target: 'node',
  node: {
    __dirname: true,
    __filename: true
  },
  externals(context, request, callback) {
    return nodeExternalsFn(context, request, function() {
      if (request.indexOf('react-native') >= 0) {
        return callback(null, 'commonjs ' + request + '-web');
      } else {
        return callback(...arguments);
      }
    });
  },
  module: {
    rules: [
      {
        test: /\.scss$/,
        use: __DEV__ ? [
          { loader: 'isomorphic-style-loader' },
          { loader: 'css-loader', options: { sourceMap: true } },
          { loader: 'postcss-loader', options: { sourceMap: true } },
          { loader: 'sass-loader', options: { sourceMap: true } }] :
          [{ loader: 'ignore-loader' }]
      }
    ]
  },
  output: {
    devtoolModuleFilenameTemplate: __DEV__ ? '../../[resource-path]' : undefined,
    devtoolFallbackModuleFilenameTemplate: __DEV__ ? '../../[resource-path];[hash]' : undefined,
    filename: '[name].js',
    sourceMapFilename: '[name].[chunkhash].js.map',
    path: path.resolve(pkg.app.backendBuildDir),
    publicPath: '/'
  },
  plugins: serverPlugins
}, appConfigs.serverConfig);

const createClientPlugins = () => {
  let clientPlugins = [
    new ManifestPlugin({
      fileName: 'assets.json'
    }),
    new webpack.DefinePlugin(Object.assign({
      __CLIENT__: true, __SERVER__: false, __SSR__: IS_SSR,
      __DEV__: __DEV__, 'process.env.NODE_ENV': `"${buildNodeEnv}"`,
      __PERSIST_GQL__: IS_PERSIST_GQL,
      __EXTERNAL_BACKEND_URL__: appConfigs.serverConfig.url ? `"${appConfigs.serverConfig.url}"`: false
    })),
    clientPersistPlugin
  ];

  if (appConfigs.serverConfig.url) {
    clientPlugins.push(new HtmlWebpackPlugin({
      template: 'tools/html-plugin-template.ejs',
      inject: 'body',
    }));
  }
  
  if (!__DEV__) {
    clientPlugins.push(new ExtractTextPlugin({ filename: '[name].[contenthash].css', allChunks: true }));
    clientPlugins.push(new webpack.optimize.CommonsChunkPlugin({
      name: "vendor",
      filename: "[name].[hash].js",
      minChunks: function(module) {
        return module.resource && module.resource.indexOf(path.resolve('./node_modules')) === 0;
      }
    }));
  }
  return clientPlugins;
};

const baseDevServerConfig = {
  hot: true,
  contentBase: '/',
  publicPath: '/',
  headers: { 'Access-Control-Allow-Origin': '*' },
  quiet: false,
  noInfo: true,
  stats: { colors: true, chunkModules: false }
};

const webConfig = merge.smart(_.cloneDeep(createBaseConfig("web")), {
  name: 'web-frontend',
  devtool: __DEV__ ? '#cheap-module-source-map' : '#source-map',
  module: {
    rules: [
      {
        test: /\.scss$/,
        use: __DEV__ ? [
          { loader: 'style-loader' },
          { loader: 'css-loader', options: { sourceMap: true, importLoaders: 1 } },
          { loader: 'postcss-loader', options: { sourceMap: true } },
          { loader: 'sass-loader', options: { sourceMap: true } },
        ] : ExtractTextPlugin.extract({
          fallback: "style-loader",
          use: ['css-loader', 'postcss-loader', 'sass-loader']
        })
      }
    ]
  },
  output: {
    filename: '[name].[hash].js',
    path: path.resolve(pkg.app.frontendBuildDir),
    publicPath: '/'
  },
  plugins: createClientPlugins(),
  devServer: _.merge({}, baseDevServerConfig, {
    port: pkg.app.webpackDevPort,
    proxy: {
      '!/*.hot-update.{json,js}': {
        target: `http://localhost:${pkg.app.apiPort}`,
        logLevel: 'info'
      }
    }
  }),
}, appConfigs.webConfig);

let mobilePlugins = createClientPlugins();

const createMobileConfig = platform => merge.smart(_.cloneDeep(createBaseConfig(platform)), {
  devtool: __DEV__ ? '#cheap-module-source-map' : '#source-map',
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules\/(?!react|@expo|expo|lottie-react-native|haul-cli|pretty-format)/,
        use: [{
          loader: 'babel-loader',
          options: {
            cacheDirectory: __DEV__,
            presets: ["babel-preset-expo", ["es2015", { "modules": false }], "stage-0"],
            plugins: [
              "transform-runtime",
              "transform-decorators-legacy",
              "transform-class-properties",
              require.resolve('haul-cli/src/utils/fixRequireIssues'),
              ["styled-components", { "ssr": true } ]
            ].concat(__DEV__ && pkg.app.reactHotLoader ? ['react-hot-loader/babel'] : []),
            only: ["*.js", "*.jsx"],
            env: {
              development: {
                plugins: ["transform-react-jsx-source"]
              }
            }
          }
        }].concat(
          pkg.app.persistGraphQL ?
            ['persistgraphql-webpack-plugin/js-loader'] : []
        )
      },
      {
        test: AssetResolver.test,
        use: {
          loader: require.resolve('haul-cli/src/loaders/assetLoader'),
          query: { platform, root: path.resolve('.'), bundle: false },
        },
      },
    ]
  },
  output: {
    filename: `index.${platform}.bundle`,
    publicPath: '/'
  },
  resolve: {
    plugins: [
      new HasteResolver({
        directories: [path.resolve('node_modules/react-native')],
      }),
      new AssetResolver({ platform }),
    ],
    mainFields: ['react-native', 'browser', 'main']
  },
  plugins: [
    new webpack.SourceMapDevToolPlugin({
      test: /\.(js|jsx|css|bundle)($|\?)/i,
      filename: '[file].map',
    }),
    ...mobilePlugins
  ]
});

const androidConfig = merge.smart(_.cloneDeep(createMobileConfig('android')), {
  name: 'android-frontend',
  output: {
    path: path.resolve(path.join(pkg.app.frontendBuildDir, 'android')),
  },
  devServer: _.merge({}, baseDevServerConfig, {
    port: 3010
  })
}, appConfigs.androidConfig);

const iOSConfig = merge.smart(_.cloneDeep(createMobileConfig('ios')), {
  name: 'ios-frontend',
  output: {
    path: path.resolve(path.join(pkg.app.frontendBuildDir, 'ios')),
  },
  devServer: _.merge({}, baseDevServerConfig, {
    port: 3020
  })
}, appConfigs.iOSConfig);

const dllConfig = merge.smart(_.cloneDeep(createBaseConfig("dll")), {
  name: 'dll',
  entry: {
    vendor: _.without(_.keys(pkg.dependencies), 'expo', 'react-native'),
  },
  plugins: [
    new webpack.DefinePlugin(Object.assign({
      __DEV__: __DEV__, 'process.env.NODE_ENV': `"${buildNodeEnv}"`
    })),
    new webpack.DllPlugin({
      name: '[name]',
      path: path.join(pkg.app.frontendBuildDir, '[name]_dll.json'),
    })
  ],
  output: {
    filename: '[name].[hash]_dll.js',
    path: path.resolve(pkg.app.frontendBuildDir),
    library: '[name]',
  },
});

module.exports =
  IS_TEST ?
    serverConfig :
    [serverConfig, webConfig, dllConfig, androidConfig, iOSConfig];
