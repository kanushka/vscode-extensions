#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DIRECT_DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const SIMPLE_SEMVER_PATTERN = /^(?:\^|~)?v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      parsed[key] = 'true';
      continue;
    }

    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

function readJsonFile(jsonPath, fallbackValue = null) {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    if (fallbackValue !== null) {
      return fallbackValue;
    }
    throw error;
  }
}

function writeJsonFile(jsonPath, value) {
  const folderPath = path.dirname(jsonPath);
  fs.mkdirSync(folderPath, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseSemver(version) {
  const matched = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.+)?$/.exec(version);
  if (!matched) {
    return null;
  }

  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    preRelease: matched[4] || ''
  };
}

function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);

  if (!left || !right) {
    return leftVersion.localeCompare(rightVersion);
  }

  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  if (!left.preRelease && right.preRelease) {
    return 1;
  }

  if (left.preRelease && !right.preRelease) {
    return -1;
  }

  return left.preRelease.localeCompare(right.preRelease);
}

function pickHigherVersion(firstVersion, secondVersion) {
  if (!firstVersion) {
    return secondVersion;
  }

  if (!secondVersion) {
    return firstVersion;
  }

  return compareSemver(firstVersion, secondVersion) >= 0 ? firstVersion : secondVersion;
}

function extractSemverCandidates(fixedVersionText) {
  if (!fixedVersionText || typeof fixedVersionText !== 'string') {
    return [];
  }

  const matches = fixedVersionText.match(/v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g);
  if (!matches) {
    return [];
  }

  return [...new Set(matches.map((value) => value.replace(/^v/, '')))];
}

function pickPreferredFixedVersion(fixedVersionText, installedVersionText) {
  const candidates = extractSemverCandidates(fixedVersionText);
  if (candidates.length === 0) {
    return null;
  }

  const installed = parseSemver((installedVersionText || '').replace(/^v/, ''));
  if (installed) {
    const sameMajorCandidates = candidates.filter((candidate) => {
      const parsed = parseSemver(candidate);
      return parsed && parsed.major === installed.major;
    });

    if (sameMajorCandidates.length > 0) {
      return sameMajorCandidates.reduce((best, candidate) => pickHigherVersion(best, candidate), null);
    }
  }

  return candidates.reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }

    return compareSemver(best, candidate) <= 0 ? best : candidate;
  }, null);
}

function collectPackageFixVersions(trivyReport) {
  const packageFixes = {};

  const results = Array.isArray(trivyReport?.Results) ? trivyReport.Results : [];

  for (const result of results) {
    const vulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];

    for (const vulnerability of vulnerabilities) {
      const packageName = vulnerability?.PkgName;
      const fixedVersionText = vulnerability?.FixedVersion;
      const installedVersionText = vulnerability?.InstalledVersion;

      if (!packageName || !fixedVersionText) {
        continue;
      }

      const preferredVersion = pickPreferredFixedVersion(fixedVersionText, installedVersionText);
      if (!preferredVersion) {
        continue;
      }

      packageFixes[packageName] = pickHigherVersion(packageFixes[packageName], preferredVersion);
    }
  }

  return packageFixes;
}

function collectVulnerabilityEntries(trivyReport) {
  const entries = [];
  const seenKeys = new Set();
  const results = Array.isArray(trivyReport?.Results) ? trivyReport.Results : [];

  for (const result of results) {
    const vulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];
    const target = result?.Target || 'unknown-target';

    for (const vulnerability of vulnerabilities) {
      const vulnerabilityId = vulnerability?.VulnerabilityID || 'UNKNOWN';
      const packageName = vulnerability?.PkgName || 'unknown-package';
      const installedVersion = vulnerability?.InstalledVersion || 'unknown';
      const fixedVersion = vulnerability?.FixedVersion || '';
      const severity = vulnerability?.Severity || 'UNKNOWN';

      const dedupeKey = `${target}|${vulnerabilityId}|${packageName}|${installedVersion}|${fixedVersion}|${severity}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);

      entries.push({
        target,
        vulnerabilityId,
        packageName,
        installedVersion,
        fixedVersion,
        severity
      });
    }
  }

  return entries;
}

function listTrackedPackageJsonFiles() {
  const output = execFileSync('git', ['ls-files'], {
    encoding: 'utf8'
  });

  return output
    .split('\n')
    .filter((filePath) => filePath === 'package.json' || filePath.endsWith('/package.json'))
    .filter((filePath) => !filePath.startsWith('common/temp/'))
    .filter((filePath) => !filePath.includes('/node_modules/'));
}

function resolveUpdatedSpec(dependencyName, currentSpec, fixedVersion) {
  if (typeof currentSpec !== 'string' || currentSpec.length === 0) {
    return { updatedSpec: null, reason: 'non-string dependency spec' };
  }

  const blockedPrefixes = ['workspace:', 'file:', 'link:', 'portal:', 'patch:', 'github:', 'git+', 'http:', 'https:'];
  if (blockedPrefixes.some((prefix) => currentSpec.startsWith(prefix))) {
    return { updatedSpec: null, reason: `unsupported source (${currentSpec.split(':')[0]})` };
  }

  if (currentSpec.startsWith('npm:')) {
    const expectedAliasPrefix = `npm:${dependencyName}@`;
    if (!currentSpec.startsWith(expectedAliasPrefix)) {
      return { updatedSpec: null, reason: 'alias points to a different package' };
    }

    const versionPart = currentSpec.slice(expectedAliasPrefix.length);
    const prefix = versionPart.startsWith('^') ? '^' : versionPart.startsWith('~') ? '~' : '';
    return { updatedSpec: `${expectedAliasPrefix}${prefix}${fixedVersion}`, reason: null };
  }

  if (!SIMPLE_SEMVER_PATTERN.test(currentSpec)) {
    return { updatedSpec: null, reason: 'complex version range' };
  }

  const prefix = currentSpec.startsWith('^') ? '^' : currentSpec.startsWith('~') ? '~' : '';
  return { updatedSpec: `${prefix}${fixedVersion}`, reason: null };
}

function applyDirectDependencyUpdates(packageFixes, packageJsonPaths, rootPath) {
  const updatedEntries = [];
  const skippedEntries = [];
  const handledPackageNames = new Set();

  for (const relativePackageJsonPath of packageJsonPaths) {
    const absolutePackageJsonPath = path.join(rootPath, relativePackageJsonPath);
    const packageJson = readJsonFile(absolutePackageJsonPath, null);

    if (!packageJson || typeof packageJson !== 'object') {
      continue;
    }

    let hasChanges = false;

    for (const dependencyField of DIRECT_DEP_FIELDS) {
      const dependencies = packageJson[dependencyField];

      if (!dependencies || typeof dependencies !== 'object') {
        continue;
      }

      for (const dependencyName of Object.keys(dependencies)) {
        const fixedVersion = packageFixes[dependencyName];
        if (!fixedVersion) {
          continue;
        }

        const currentSpec = dependencies[dependencyName];
        const { updatedSpec, reason } = resolveUpdatedSpec(dependencyName, currentSpec, fixedVersion);

        if (!updatedSpec) {
          skippedEntries.push({
            packageJsonPath: relativePackageJsonPath,
            dependencyField,
            dependencyName,
            currentSpec,
            reason
          });
          continue;
        }

        handledPackageNames.add(dependencyName);

        if (updatedSpec === currentSpec) {
          continue;
        }

        dependencies[dependencyName] = updatedSpec;
        hasChanges = true;

        updatedEntries.push({
          packageJsonPath: relativePackageJsonPath,
          dependencyField,
          dependencyName,
          from: currentSpec,
          to: updatedSpec
        });
      }
    }

    if (hasChanges) {
      writeJsonFile(absolutePackageJsonPath, packageJson);
    }
  }

  return {
    updatedEntries,
    skippedEntries,
    handledPackageNames: [...handledPackageNames]
  };
}

function updateTransitiveOverrides(overridesPath, transitiveFixes) {
  const existingOverrides = fs.existsSync(overridesPath)
    ? readJsonFile(overridesPath, {})
    : {};

  const normalizedOverrides = (existingOverrides && typeof existingOverrides === 'object' && !Array.isArray(existingOverrides))
    ? existingOverrides
    : {};

  const updatedEntries = [];

  for (const [dependencyName, fixedVersion] of Object.entries(transitiveFixes)) {
    const currentValue = normalizedOverrides[dependencyName];
    if (currentValue === fixedVersion) {
      continue;
    }

    if (currentValue && compareSemver(currentValue, fixedVersion) > 0) {
      continue;
    }

    normalizedOverrides[dependencyName] = fixedVersion;
    updatedEntries.push({
      dependencyName,
      from: currentValue || null,
      to: fixedVersion
    });
  }

  if (updatedEntries.length > 0) {
    const sortedOverrideEntries = Object.keys(normalizedOverrides)
      .sort((left, right) => left.localeCompare(right))
      .reduce((accumulator, dependencyName) => {
        accumulator[dependencyName] = normalizedOverrides[dependencyName];
        return accumulator;
      }, {});

    writeJsonFile(overridesPath, sortedOverrideEntries);
  }

  return {
    overridesPath,
    updatedEntries,
    totalOverrideCount: Object.keys(normalizedOverrides).length
  };
}

function updatePackageJsonOverrides(packageJsonPath, transitiveFixes) {
  const packageJson = readJsonFile(packageJsonPath, {});
  const existingOverrides = (packageJson.overrides && typeof packageJson.overrides === 'object' && !Array.isArray(packageJson.overrides))
    ? packageJson.overrides
    : {};

  const updatedEntries = [];

  for (const [dependencyName, fixedVersion] of Object.entries(transitiveFixes)) {
    const currentValue = existingOverrides[dependencyName];
    const normalizedCurrentValue = typeof currentValue === 'string' ? currentValue.replace(/^[~^]/, '') : currentValue;

    if (typeof currentValue === 'object' && currentValue !== null) {
      continue;
    }

    if (currentValue === fixedVersion) {
      continue;
    }

    if (typeof normalizedCurrentValue === 'string' && compareSemver(normalizedCurrentValue, fixedVersion) > 0) {
      continue;
    }

    existingOverrides[dependencyName] = fixedVersion;
    updatedEntries.push({
      dependencyName,
      from: currentValue || null,
      to: fixedVersion
    });
  }

  if (updatedEntries.length > 0) {
    packageJson.overrides = Object.keys(existingOverrides)
      .sort((left, right) => left.localeCompare(right))
      .reduce((accumulator, dependencyName) => {
        accumulator[dependencyName] = existingOverrides[dependencyName];
        return accumulator;
      }, {});
    writeJsonFile(packageJsonPath, packageJson);
  }

  return {
    overridesPath: packageJsonPath,
    updatedEntries,
    totalOverrideCount: Object.keys(existingOverrides).length
  };
}

function relativePathFromRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative || '.';
}

(function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootPath = process.cwd();
  const reportPath = path.resolve(rootPath, args.report || 'trivy-results.json');
  const overridesMode = args['overrides-mode'] || 'file';
  const overridesDefaultPath = overridesMode === 'package-json' ? 'package.json' : 'common/config/rush/trivy-overrides.json';
  const overridesPath = path.resolve(rootPath, args.overrides || overridesDefaultPath);
  const summaryPath = path.resolve(rootPath, args.summary || 'trivy-remediation-summary.json');

  if (!fs.existsSync(reportPath)) {
    throw new Error(`Trivy report was not found: ${relativePathFromRoot(rootPath, reportPath)}`);
  }

  const trivyReport = readJsonFile(reportPath);
  const packageFixes = collectPackageFixVersions(trivyReport);
  const vulnerabilities = collectVulnerabilityEntries(trivyReport);

  const packageJsonPaths = listTrackedPackageJsonFiles();
  const { updatedEntries, skippedEntries, handledPackageNames } = applyDirectDependencyUpdates(packageFixes, packageJsonPaths, rootPath);

  const handledDirectPackageNames = new Set(handledPackageNames);
  const transitiveFixes = Object.entries(packageFixes).reduce((accumulator, [dependencyName, fixedVersion]) => {
    if (!handledDirectPackageNames.has(dependencyName)) {
      accumulator[dependencyName] = fixedVersion;
    }
    return accumulator;
  }, {});

  const overrideResult = overridesMode === 'package-json'
    ? updatePackageJsonOverrides(overridesPath, transitiveFixes)
    : updateTransitiveOverrides(overridesPath, transitiveFixes);

  const summary = {
    generatedAt: new Date().toISOString(),
    reportPath: relativePathFromRoot(rootPath, reportPath),
    packageFixCount: Object.keys(packageFixes).length,
    vulnerabilityCount: vulnerabilities.length,
    vulnerabilities,
    directDependencyUpdateCount: updatedEntries.length,
    directDependencyPackageCount: handledDirectPackageNames.size,
    directDependencyUpdates: updatedEntries,
    skippedDirectDependencyCount: skippedEntries.length,
    skippedDirectDependencies: skippedEntries,
    transitiveOverrideUpdateCount: overrideResult.updatedEntries.length,
    transitiveOverrideUpdates: overrideResult.updatedEntries,
    overrideFilePath: relativePathFromRoot(rootPath, overridesPath),
    overridePackageCount: overrideResult.totalOverrideCount
  };

  writeJsonFile(summaryPath, summary);

  console.log(`Detected fixed versions for ${summary.packageFixCount} packages from Trivy report.`);
  console.log(`Updated ${summary.directDependencyUpdateCount} direct dependency entries across ${summary.directDependencyPackageCount} packages.`);
  console.log(`Updated ${summary.transitiveOverrideUpdateCount} transitive override entries in ${summary.overrideFilePath}.`);
  console.log(`Summary written to ${relativePathFromRoot(rootPath, summaryPath)}.`);
})();
