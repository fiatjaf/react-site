const fs = require('fs')
const path = require('path')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const glob = require('glob')
const copy = require('cp-file')
const React = require('react')
const ReactHelmet = require('react-helmet').default
const yargs = require('yargs')
const renderToString = require('react-dom/server').renderToString
const browserify = require('browserify')

const extract = require('./extract')
const {standaloneURL} = require('./utils')

const targetdirname = yargs.argv['target-dir'] || process.env.TARGET_DIR || '_site'
const targetdir = path.join(process.cwd(), targetdirname)

const defaultIgnore = [
  '**/node_modules/**',
  '**/.*',
  `${targetdirname}/**`,
  yargs.argv['$0'],
  yargs.argv.helmet,
  yargs.argv.body
]
var usedComponents = []

var globals = {
  baseURL: yargs.argv['base-url'] || process.env.BASE_URL || '',
  production: yargs.argv['production'] || process.env.PRODUCTION || false
}

module.exports.init = function () {
  // cleanup and prepare the _site directory
  rimraf.sync(path.join(targetdir, '*'))
  mkdirp.sync(targetdir)
}

module.exports.listFiles = function (options) {
  var {ignore} = options || {}
  ignore = ignore || []

  return glob.sync(
    '**/*.*(js|ts|jsx|tsx|md|html|txt|markdown|rst|text|text|latex|asciidoc)'
  , {
    ignore: defaultIgnore.concat(ignore)
  })
    .map(extract)
}

module.exports.generatePage = function (pathname, componentpath, props) {
  console.log(`  > generating pages at ${pathname}`)
  console.log(`    - component: ${componentpath}`)
  console.log(`    - props: ${Object.keys(props).join(', ')}`)
  usedComponents.push(componentpath)
  let targetpath = path.join(targetdir, pathname, 'index.html')

  let staticprops = Object.assign({
    location: {
      pathname,
      search: ''
    }
  }, props)

  /* generating static HTML */
  let Helmet = require(yargs.argv.helmet)
  let Body = require(yargs.argv.body)
  let Component = require(componentpath)

  let page = React.createElement(Body, staticprops,
    React.createElement(Helmet, staticprops),
    React.createElement(Component, staticprops)
  )

  let output = renderToString(page)
  let head = ReactHelmet.renderStatic()
  let html = '<!doctype html>' +
  '<html ' + head.htmlAttributes.toString() + '>' +
    '<head>' +
      head.meta.toString() +
      head.base.toString() +
      head.title.toString() +
      head.link.toString() +
      head.noscript.toString() +
      head.script.toString() +
    '</head>' +
    '<body>' + output + '</body>' +
  '</html>'

  mkdirp.sync(path.dirname(targetpath))
  fs.writeFileSync(targetpath, html, {encoding: 'utf-8'})
  /* --- */

  /* generating standalone JS file */
  let b = browserify(path.join(__dirname, '/templates/standalone.js'), {
    standalone: 'doesntmatter',
    ignoreMissing: true,
    bundleExternal: false,
    paths: process.env.NODE_PATH.split(':'),
    debug: !globals.production
  })
  b.exclude(componentpath)
  b.transform(
    'envify',
    {props, componentpath}
  )
  let br = b.bundle()

  let targetjs = path.join(targetdir, standaloneURL(pathname))
  let w = fs.createWriteStream(targetjs, {encoding: 'utf-8'})
  br.pipe(w)
  br.on('end', () =>
    w.end(process.exit)
  )
  /* --- */
}

module.exports.copyStatic = function (patterns) {
  patterns
    .map(p =>
      glob.sync(p, {ignore: defaultIgnore})
    )
    .map(staticFiles =>
      staticFiles.map(filepath => {
        console.log(`  > copying static file ${filepath}.`)
        copy.sync(
          path.join(process.cwd(), filepath),
          path.join(targetdir, filepath)
        )
      })
    )
}

module.exports.end = function () {
  console.log('generating the JS bundle that puts everything together')

  let pageExternalPackages = Object.keys(
    require(path.join(process.cwd(), 'package.json'))
      .dependencies
  )

  let b = browserify(path.join(__dirname, '/templates/main.js'), {
    paths: process.env.NODE_PATH.split(':'),
    debug: !globals.production
  })
  b.transform(
    'envify',
    {
      utils: path.join(__dirname, 'utils'),
      body: yargs.argv.body,
      helmet: yargs.argv.helmet,
      globals: globals
    }
  )
  b.require([
    'react',
    'react-dom',
    'react-helmet',
    'history',
    'catch-links',
    'micro-amd',
    path.join(__dirname, 'utils')
  ])
  b.require(pageExternalPackages)
  b.require(yargs.argv.helmet)
  b.require(yargs.argv.body)
  b.require(usedComponents)
  let br = b.bundle()

  let w = fs.createWriteStream(path.join(targetdir, 'bundle.js'), {encoding: 'utf-8'})
  br.pipe(w)
  br.on('end', () =>
    w.end(process.exit)
  )
}
