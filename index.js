const core = require("@actions/core");
const github = require("@actions/github");
const { exec } = require("@actions/exec");
const { issueCommand } = require("@actions/core/lib/command");

const path = require("path");
const fs = require("fs-extra");
const semver = require("semver");

const { context } = github;

async function dockerLogin() {
  const runnerTempDirectory = process.env["RUNNER_TEMP"]; // Using process.env until the core libs are updated
  const dirPath =
    process.env["DOCKER_CONFIG"] ||
    path.resolve(runnerTempDirectory, `docker_login_${Date.now()}`);
  const dockerConfigPath = path.resolve(dirPath, `config.json`);

  const token = process.env["GITHUB_TOKEN"];
  if (!token) throw new Error("please set then GITHUB_TOKEN env");

  let config;
  if (await fs.pathExists(dockerConfigPath)) {
    try {
      config = await fs.readJson(dockerConfigPath);
      if (!config.auths) {
        config.auths = {};
      }
    } catch (err) {
      // if the file is invalid, just overwrite it
      config = { auths: {} };
    }
  } else {
    config = { auths: {} };
  }
  config.auths["docker.pkg.github.com"] = {
    auth: Buffer.from(`${context.actor}:${token}`).toString("base64")
  };

  await fs.outputJson(dockerConfigPath, config);
  issueCommand("set-env", { name: "DOCKER_CONFIG" }, dirPath);
  console.log("DOCKER_CONFIG environment variable is set");
}

function parseVersion(gitRef) {
  let version = gitRef.substring(10);

  if (semver.valid(version)) {
    return semver.clean(version);
  } else {
    throw new Error(
      `Can't parse a valid semver version from git ref [${gitRef}]`
    );
  }
}

async function runCmd(cmd) {
  await exec(cmd, undefined, {
    stdout: data => {
      core.info(data.toString());
    },
    stderr: data => {
      core.error(data.toString());
    }
  });
}

async function run() {
  const repository = context.repo;
  const imageName = core.getInput("name") || context.repo.repo;
  const version = parseVersion(core.getInput("ref"));

  let imageTag = `docker.pkg.github.com/${context.repo.owner}/${context.repo.repo}/${imageName}:${version}`.toLowerCase();
  core.info(`image's tag : ${imageTag}`);
  core.setOutput("image-tag", imageTag);

  await dockerLogin();

  let buildCmd = `docker build . --tag ${imageTag}`;
  let arg = core.getInput("arg");
  if (arg) buildCmd += ` --build-arg ${arg}`;
  await runCmd("ls -a");
  await runCmd(buildCmd);

  let pushCmd = `docker push ${imageTag}`;
  await runCmd(pushCmd);
}

run().catch(error => core.setFailed(error.message));
