'use strict';

/**
 * When using the PNPM package manager, you can use pnpmfile.js to workaround
 * dependencies that have mistakes in their package.json file.  (This feature is
 * functionally similar to Yarn's "resolutions".)
 *
 * For details, see the PNPM documentation:
 * https://pnpm.js.org/docs/en/hooks.html
 *
 * IMPORTANT: SINCE THIS FILE CONTAINS EXECUTABLE CODE, MODIFYING IT IS LIKELY TO INVALIDATE
 * ANY CACHED DEPENDENCY ANALYSIS.  After any modification to pnpmfile.js, it's recommended to run
 * "rush update --full" so that PNPM will recalculate all version selections.
 */
module.exports = {
  hooks: {
    readPackage(pkg, context) {
      if (pkg.dependencies) {
        if (pkg.dependencies['vfile']) {
          pkg.dependencies['vfile'] = '6.0.3';
        }
        
        // Security vulnerability fixes
        if (pkg.dependencies['@isaacs/brace-expansion']) {
          pkg.dependencies['@isaacs/brace-expansion'] = '^5.0.1';
        }
        if (pkg.dependencies['brace-expansion']) {
          pkg.dependencies['brace-expansion'] = '^2.0.2';
        }
        if (pkg.dependencies['http-proxy']) {
          pkg.dependencies['http-proxy'] = '^1.18.1';
        }
        if (pkg.dependencies['prismjs']) {
          pkg.dependencies['prismjs'] = '^1.30.0';
        }
        if (pkg.dependencies['webpack']) {
          pkg.dependencies['webpack'] = '^5.94.0';
        }
        if (pkg.dependencies['webpack-dev-server']) {
          pkg.dependencies['webpack-dev-server'] = '^5.2.1';
        }
        if (pkg.dependencies['braces']) {
          pkg.dependencies['braces'] = '^3.0.3';
        }
        if (pkg.dependencies['micromatch']) {
          pkg.dependencies['micromatch'] = '^4.0.8';
        }
        if (pkg.dependencies['minimatch']) {
          pkg.dependencies['minimatch'] = '^10.2.3';
        }
        if (pkg.dependencies['esbuild']) {
          pkg.dependencies['esbuild'] = '^0.25.0';
        }
        if (pkg.dependencies['xmldom']) {
          pkg.dependencies['xmldom'] = 'npm:@xmldom/xmldom@^0.8.10';
        }
        if (pkg.dependencies['@eslint/plugin-kit']) {
          pkg.dependencies['@eslint/plugin-kit'] = '^0.3.4';
        }
        if (pkg.dependencies['on-headers']) {
          pkg.dependencies['on-headers'] = '^1.1.0';
        }
        if (pkg.dependencies['form-data']) {
          pkg.dependencies['form-data'] = '^4.0.4';
        }
        if (pkg.dependencies['min-document']) {
          pkg.dependencies['min-document'] = '^2.19.1';
        }
        if (pkg.dependencies['js-yaml']) {
          pkg.dependencies['js-yaml'] = '^4.1.1';
        }
        if (pkg.dependencies['diff']) {
          pkg.dependencies['diff'] = '^8.0.3';
        }
        if (pkg.dependencies['eslint']) {
          pkg.dependencies['eslint'] = '^9.27.0';
        }
        if (pkg.dependencies['fast-xml-parser']) {
          pkg.dependencies['fast-xml-parser'] = '^5.3.8';
        }
        if (pkg.dependencies['axios']) {
          pkg.dependencies['axios'] = '^1.13.5';
        }
        if (pkg.dependencies['dompurify']) {
          pkg.dependencies['dompurify'] = '^3.2.7';
        }
        if (pkg.dependencies['express-rate-limit']) {
          pkg.dependencies['express-rate-limit'] = '^8.2.2';
        }
        if (pkg.dependencies['hono']) {
          pkg.dependencies['hono'] = '^4.12.4';
        }
        if (pkg.dependencies['immutable']) {
          pkg.dependencies['immutable'] = '^3.8.3';
        }
        if (pkg.dependencies['markdown-it']) {
          pkg.dependencies['markdown-it'] = '^14.1.1';
        }
        if (pkg.dependencies['qs']) {
          pkg.dependencies['qs'] = '^6.14.2';
        }
        if (pkg.dependencies['serialize-javascript']) {
          pkg.dependencies['serialize-javascript'] = '^7.0.3';
        }
        if (pkg.dependencies['underscore']) {
          pkg.dependencies['underscore'] = '^1.13.8';
        }
        if (pkg.dependencies['@hono/node-server']) {
          pkg.dependencies['@hono/node-server'] = '^1.19.10';
        }
        if (pkg.dependencies['@tootallnate/once']) {
          pkg.dependencies['@tootallnate/once'] = '^3.0.1';
        }
        if (pkg.dependencies['ajv']) {
          pkg.dependencies['ajv'] = '^8.18.0';
        }
        if (pkg.dependencies['file-type']) {
          pkg.dependencies['file-type'] = '^21.3.1';
        }
      }

      if (pkg.devDependencies) {
        // Security vulnerability fixes for dev dependencies
        if (pkg.devDependencies['@isaacs/brace-expansion']) {
          pkg.devDependencies['@isaacs/brace-expansion'] = '^5.0.1';
        }
        if (pkg.devDependencies['brace-expansion']) {
          pkg.devDependencies['brace-expansion'] = '^2.0.2';
        }
        if (pkg.devDependencies['http-proxy']) {
          pkg.devDependencies['http-proxy'] = '^1.18.1';
        }
        if (pkg.devDependencies['prismjs']) {
          pkg.devDependencies['prismjs'] = '^1.30.0';
        }
        if (pkg.devDependencies['webpack']) {
          pkg.devDependencies['webpack'] = '^5.94.0';
        }
        if (pkg.devDependencies['webpack-dev-server']) {
          pkg.devDependencies['webpack-dev-server'] = '^5.2.1';
        }
        if (pkg.devDependencies['braces']) {
          pkg.devDependencies['braces'] = '^3.0.3';
        }
        if (pkg.devDependencies['micromatch']) {
          pkg.devDependencies['micromatch'] = '^4.0.8';
        }
        if (pkg.devDependencies['minimatch']) {
          pkg.devDependencies['minimatch'] = '^10.2.3';
        }
        if (pkg.devDependencies['esbuild']) {
          pkg.devDependencies['esbuild'] = '^0.25.0';
        }
        if (pkg.devDependencies['xmldom']) {
          pkg.devDependencies['xmldom'] = 'npm:@xmldom/xmldom@^0.8.10';
        }
        if (pkg.devDependencies['@eslint/plugin-kit']) {
          pkg.devDependencies['@eslint/plugin-kit'] = '^0.3.4';
        }
        if (pkg.devDependencies['on-headers']) {
          pkg.devDependencies['on-headers'] = '^1.1.0';
        }
        if (pkg.devDependencies['form-data']) {
          pkg.devDependencies['form-data'] = '^4.0.4';
        }
        if (pkg.devDependencies['min-document']) {
          pkg.devDependencies['min-document'] = '^2.19.1';
        }
        if (pkg.devDependencies['diff']) {
          pkg.devDependencies['diff'] = '^8.0.3';
        }
        if (pkg.devDependencies['eslint']) {
          pkg.devDependencies['eslint'] = '^9.27.0';
        }
        if (pkg.devDependencies['fast-xml-parser']) {
          pkg.devDependencies['fast-xml-parser'] = '^5.3.8';
        }
        if (pkg.devDependencies['axios']) {
          pkg.devDependencies['axios'] = '^1.13.5';
        }
        if (pkg.devDependencies['dompurify']) {
          pkg.devDependencies['dompurify'] = '^3.2.7';
        }
        if (pkg.devDependencies['express-rate-limit']) {
          pkg.devDependencies['express-rate-limit'] = '^8.2.2';
        }
        if (pkg.devDependencies['hono']) {
          pkg.devDependencies['hono'] = '^4.12.4';
        }
        if (pkg.devDependencies['immutable']) {
          pkg.devDependencies['immutable'] = '^3.8.3';
        }
        if (pkg.devDependencies['markdown-it']) {
          pkg.devDependencies['markdown-it'] = '^14.1.1';
        }
        if (pkg.devDependencies['qs']) {
          pkg.devDependencies['qs'] = '^6.14.2';
        }
        if (pkg.devDependencies['serialize-javascript']) {
          pkg.devDependencies['serialize-javascript'] = '^7.0.3';
        }
        if (pkg.devDependencies['underscore']) {
          pkg.devDependencies['underscore'] = '^1.13.8';
        }
        if (pkg.devDependencies['@hono/node-server']) {
          pkg.devDependencies['@hono/node-server'] = '^1.19.10';
        }
        if (pkg.devDependencies['@tootallnate/once']) {
          pkg.devDependencies['@tootallnate/once'] = '^3.0.1';
        }
        if (pkg.devDependencies['ajv']) {
          pkg.devDependencies['ajv'] = '^8.18.0';
        }
        if (pkg.devDependencies['file-type']) {
          pkg.devDependencies['file-type'] = '^21.3.1';
        }
      }

      return pkg;
    }
  }
};

/**
 * This hook is invoked during installation before a package's dependencies
 * are selected.
 * The `packageJson` parameter is the deserialized package.json
 * contents for the package that is about to be installed.
 * The `context` parameter provides a log() function.
 * The return value is the updated object.
 */
function readPackage(packageJson, context) {
  // // The karma types have a missing dependency on typings from the log4js package.
  // if (packageJson.name === '@types/karma') {
  //  context.log('Fixed up dependencies for @types/karma');
  //  packageJson.dependencies['log4js'] = '0.6.38';
  // }

  return packageJson;
}
