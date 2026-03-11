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
        // Security vulnerability fixes
        if (pkg.dependencies['fast-xml-parser']) {
          pkg.dependencies['fast-xml-parser'] = '^5.3.8';
        }
        if (pkg.dependencies['minimatch']) {
          pkg.dependencies['minimatch'] = '^10.2.3';
        }
      }

      if (pkg.devDependencies) {
        // Security vulnerability fixes for dev dependencies
        if (pkg.devDependencies['fast-xml-parser']) {
          pkg.devDependencies['fast-xml-parser'] = '^5.3.8';
        }
        if (pkg.devDependencies['minimatch']) {
          pkg.devDependencies['minimatch'] = '^10.2.3';
        }
      }

      return pkg;
    }
  }
};
