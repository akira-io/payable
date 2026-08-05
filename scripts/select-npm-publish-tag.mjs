const version = process.argv[2];
const versionWithoutBuildMetadata = version.split('+', 1)[0];
process.stdout.write(versionWithoutBuildMetadata.includes('-') ? 'beta' : 'latest');
