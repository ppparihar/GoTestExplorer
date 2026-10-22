"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode8 = __toESM(require("vscode"));

// src/goTestExplorer.ts
var vscode7 = __toESM(require("vscode"));
var path8 = __toESM(require("path"));

// src/goTestProvider.ts
var vscode = __toESM(require("vscode"));
var path = __toESM(require("path"));

// src/icons.ts
var Icons = class {
  static get loading() {
    return "spinner.svg";
  }
  static get testSuite() {
    return "testSuite.svg";
  }
  static get test() {
    return "test.svg";
  }
  static get testPassed() {
    return "testPassed.svg";
  }
  static get testFailed() {
    return "testFailed.svg";
  }
  static get testSuitePassed() {
    return "testSuitePassed.svg";
  }
  static get testSuiteFailed() {
    return "testSuiteFailed.svg";
  }
};

// src/testNode.ts
var TestNode = class {
  constructor(name, uri, _children) {
    this.name = name;
    this.uri = uri;
    this._children = _children;
  }
  name;
  uri;
  _children;
  _testResult;
  _isLoading = false;
  get isTestSuite() {
    return !!this._children && this._children.length > 0;
  }
  get tooltip() {
    return `${this.name}`;
  }
  set testResult(testResult) {
    this._testResult = testResult;
    this.loadingCompleted();
  }
  get testResult() {
    return this._testResult;
  }
  get icon() {
    return this._isLoading ? Icons.loading : this.isTestSuite ? this.getTestSuiteIcon : !this.testResult ? Icons.test : this.testResult.isPassed ? Icons.testPassed : Icons.testFailed;
  }
  get children() {
    return this._children ? this._children : [];
  }
  get isLoading() {
    return this._isLoading;
  }
  get getTestSuiteIcon() {
    if (this.children.filter((x) => x.isLoading).length > 0) {
      return Icons.loading;
    }
    for (let index = 0; index < this.children.length; index++) {
      const testResult = this.children[index].testResult;
      if (!testResult) {
        return Icons.testSuite;
      }
      if (!testResult.isPassed) {
        return Icons.testSuiteFailed;
      }
    }
    return Icons.testSuitePassed;
  }
  setLoading() {
    this._isLoading = true;
  }
  loadingCompleted() {
    this._isLoading = false;
  }
};

// src/goTestProvider.ts
var GoTestProvider = class {
  constructor(context, commands2) {
    this.context = context;
    context.subscriptions.push(commands2.discoveredTest(this.onDicoveredTest, this));
    context.subscriptions.push(commands2.testDiscoveryStarted(this.onDiscoverTestStart, this));
    context.subscriptions.push(commands2.testResult(this.updateTestResult, this));
    context.subscriptions.push(commands2.testRunStarted(this.onTestRunStarted, this));
    context.subscriptions.push(commands2.testCompleted(this.onTestRunCompleted, this));
    context.subscriptions.push(commands2.testFileChanged(this.onTestFileChanged, this));
    context.subscriptions.push(commands2.testFileRemoved(this.onTestFileRemoved, this));
  }
  context;
  _onDidChangeTreeData = new vscode.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  __discoveredTestsMap = /* @__PURE__ */ new Map();
  _discoveredTests = [];
  _discovering;
  /**
   * The nodes whose result changed since the tree was last redrawn.
   */
  _pendingResults = /* @__PURE__ */ new Set();
  refresh(testNode) {
    this._pendingResults.clear();
    this._onDidChangeTreeData.fire(testNode);
  }
  getTreeItem(testNode) {
    const treeItem = new vscode.TreeItem(
      testNode.name,
      testNode.isTestSuite ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
    treeItem.contextValue = this._discovering ? "discovering" : testNode.isTestSuite ? "testSuite" : "test";
    if (!testNode.isTestSuite) {
      treeItem.command = {
        command: "goTestExplorer.goToLocation",
        title: testNode.tooltip,
        arguments: [testNode]
      };
    }
    treeItem.iconPath = {
      dark: this.context.asAbsolutePath(path.join("resources", "dark", testNode.icon)),
      light: this.context.asAbsolutePath(path.join("resources", "light", testNode.icon))
    };
    return treeItem;
  }
  getChildren(testNode) {
    if (testNode) {
      return Promise.resolve(testNode.children);
    }
    if (this._discovering) {
      return Promise.resolve([new TestNode("Loading...", null)]);
    }
    return Promise.resolve(this._discoveredTests);
  }
  get discoveredTests() {
    return this._discoveredTests;
  }
  getDiscoveredTestNode(key) {
    return this.__discoveredTestsMap.get(key);
  }
  /**
   * Applies the outcome of a test.
   *
   * The tree is not redrawn here: the outcome of every test of a run arrives
   * one after the other, and the tree is redrawn once when the run has
   * finished.
   */
  updateTestResult(testResult) {
    const testNode = this.__discoveredTestsMap.get(
      this.getNodeKey(testResult.uri.fsPath, testResult.testName)
    );
    if (testNode) {
      testNode.testResult = testResult;
      this._pendingResults.add(testNode);
    }
  }
  onDiscoverTestStart() {
    this._discoveredTests = [];
    this._discovering = true;
    this.refresh();
  }
  onDicoveredTest(testNodeList) {
    const previousMap = this.__discoveredTestsMap;
    this._discoveredTests = testNodeList && testNodeList.length > 0 ? testNodeList : [];
    this.__discoveredTestsMap = /* @__PURE__ */ new Map();
    this._discoveredTests.forEach((x) => this.registerNodeTree(x, previousMap));
    this._discovering = false;
    this.refresh();
  }
  /**
   * Replaces the node for one file, without rebuilding the rest of the
   * tree.
   *
   * The outcome of tests that have already run is carried over, exactly as
   * a full refresh does.
   */
  onTestFileChanged(testNode) {
    const filePath = testNode.uri.fsPath;
    const previous = this.takeEntriesFor(filePath);
    const index = this._discoveredTests.findIndex((node) => node.uri.fsPath === filePath);
    if (index >= 0) {
      this._discoveredTests[index] = testNode;
    } else {
      this._discoveredTests.push(testNode);
    }
    this.registerNodeTree(testNode, previous);
    this.refresh();
  }
  /**
   * Drops the node for a file that no longer holds tests.
   */
  onTestFileRemoved(filePath) {
    const index = this._discoveredTests.findIndex((node) => node.uri.fsPath === filePath);
    if (index >= 0) {
      this._discoveredTests.splice(index, 1);
    }
    this.takeEntriesFor(filePath);
    this.refresh();
  }
  /**
   * Registers a node and, when it is a suite, its children.
   */
  registerNodeTree(node, previousMap) {
    if (node.isTestSuite) {
      node.children.forEach((child) => this.registerNodeTree(child, previousMap));
    }
    this.registerNode(node, previousMap);
  }
  /**
   * Removes the lookup entries for one file and returns them, so that the
   * outcome of the tests it holds can be carried over to the new nodes.
   */
  takeEntriesFor(filePath) {
    const prefix = filePath + "__";
    const taken = /* @__PURE__ */ new Map();
    this.__discoveredTestsMap.forEach((node, key) => {
      if (key.startsWith(prefix)) {
        taken.set(key, node);
        this.__discoveredTestsMap.delete(key);
      }
    });
    return taken;
  }
  /**
   * Registers a node in the lookup map, carrying over the result of the
   * matching node from the previous discovery so that a refresh does not
   * discard the outcome of tests that have already run.
   */
  registerNode(node, previousMap) {
    const key = this.getNodeKey(node.uri.fsPath, node.name);
    const previous = previousMap ? previousMap.get(key) : void 0;
    if (previous && previous.testResult && !node.testResult) {
      node.testResult = previous.testResult;
    }
    this.__discoveredTestsMap.set(key, node);
  }
  /**
   * The tests of a run have started.
   *
   * Every test of the run is marked as running, and the tree is redrawn
   * once for the whole run.
   */
  onTestRunStarted(testNodes) {
    testNodes.forEach((testNode) => this.setLoading(testNode));
    this.refresh(this.topNodeOf(testNodes));
  }
  /**
   * The run that covers the given files has finished, so the tree is
   * redrawn once with the outcome of every test of that run.
   *
   * A run that covered several files has no single node to redraw, so the
   * whole tree is redrawn.
   */
  onTestRunCompleted(testUris) {
    if (testUris.length === 1) {
      const testUri = testUris[0];
      const suite = this.__discoveredTestsMap.get(
        this.getNodeKey(testUri.fsPath, path.basename(testUri.fsPath))
      );
      this.refresh(suite);
      return;
    }
    this.refresh();
  }
  /**
   * The node that holds the others, so the tree is redrawn once for the
   * whole group.
   *
   * A group that spans several suites has no single node to redraw, so the
   * whole tree is redrawn.
   */
  topNodeOf(testNodes) {
    const tops = testNodes.filter(
      (node) => !testNodes.some(
        (other) => other !== node && other.isTestSuite && other.children.includes(node)
      )
    );
    return tops.length === 1 ? tops[0] : void 0;
  }
  setLoading(testNode) {
    const tempNode = this.__discoveredTestsMap.get(
      this.getNodeKey(testNode.uri.fsPath, testNode.name)
    );
    if (tempNode) {
      tempNode.setLoading();
    }
  }
  getNodeKey(uri, nodeName) {
    return uri + "__" + nodeName;
  }
};

// src/lib/testUtil.ts
var vscode5 = __toESM(require("vscode"));

// src/lib/goPath.ts
var fs = require("fs");
var path2 = require("path");
var os = require("os");
var binPathCache = {};
var envPath = process.env["PATH"] || (process.platform === "win32" ? process.env["Path"] : null);
function getBinPathFromEnvVar(toolName, envVarValue, appendBinToPath) {
  toolName = correctBinname(toolName);
  if (envVarValue) {
    const paths = envVarValue.split(path2.delimiter);
    for (let i = 0; i < paths.length; i++) {
      const binpath = path2.join(paths[i], appendBinToPath ? "bin" : "", toolName);
      if (fileExists(binpath)) {
        return binpath;
      }
    }
  }
  return null;
}
function getBinPathWithPreferredGopath(toolName, preferredGopaths, alternateTools) {
  if (binPathCache[toolName]) return binPathCache[toolName];
  const alternateTool = alternateTools && alternateTools[toolName] ? resolveHomeDir(alternateTools[toolName]) : null;
  if (alternateTool && path2.isAbsolute(alternateTool) && fileExists(alternateTool)) {
    binPathCache[toolName] = alternateTool;
    return alternateTool;
  }
  const binname = alternateTool && !path2.isAbsolute(alternateTool) ? alternateTool : toolName;
  for (let i = 0; i < preferredGopaths.length; i++) {
    if (typeof preferredGopaths[i] === "string") {
      const pathFrompreferredGoPath = getBinPathFromEnvVar(binname, preferredGopaths[i], true);
      if (pathFrompreferredGoPath) {
        binPathCache[toolName] = pathFrompreferredGoPath;
        return pathFrompreferredGoPath;
      }
    }
  }
  const pathFromGoRoot = getBinPathFromEnvVar(binname, process.env["GOROOT"], true);
  if (pathFromGoRoot) {
    binPathCache[toolName] = pathFromGoRoot;
    return pathFromGoRoot;
  }
  const pathFromPath = getBinPathFromEnvVar(binname, envPath, false);
  if (pathFromPath) {
    binPathCache[toolName] = pathFromPath;
    return pathFromPath;
  }
  if (toolName === "go") {
    const defaultPathForGo = process.platform === "win32" ? "C:\\Go\\bin\\go.exe" : "/usr/local/go/bin/go";
    if (fileExists(defaultPathForGo)) {
      binPathCache[toolName] = defaultPathForGo;
      return defaultPathForGo;
    }
    return void 0;
  }
  return toolName;
}
function correctBinname(toolName) {
  if (process.platform === "win32") return toolName + ".exe";
  else return toolName;
}
function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (e) {
    return false;
  }
}
function resolveHomeDir(inputPath) {
  if (!inputPath || !inputPath.trim()) return inputPath;
  return inputPath.startsWith("~") ? path2.join(os.homedir(), inputPath.substr(1)) : inputPath;
}
function stripBOM(s) {
  if (s && s[0] === "\uFEFF") {
    s = s.substr(1);
  }
  return s;
}
function parseEnvFile(path9) {
  let env2;
  env2 = {};
  if (!path9) {
    return env2;
  }
  try {
    const buffer = stripBOM(fs.readFileSync(path9, "utf8"));
    buffer.split("\n").forEach((line) => {
      const r = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
      if (r !== null) {
        let value = r[2] || "";
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.replace(/\\n/gm, "\n");
        }
        env2[r[1]] = value.replace(/(^['"]|['"]$)/g, "");
      }
    });
    return env2;
  } catch (e) {
    throw `Cannot load environment variables from file ${path9}`;
  }
}

// src/lib/utils.ts
var vscode2 = __toESM(require("vscode"));
var toolsGopath;
var path3 = require("path");
var os2 = require("os");
var cp = require("child_process");
function getToolsGopath(useCache = true) {
  if (!useCache || !toolsGopath) {
    toolsGopath = resolveToolsGopath();
  }
  return toolsGopath;
}
function resolveToolsGopath() {
  let toolsGopathForWorkspace = vscode2.workspace.getConfiguration("go")["toolsGopath"] || "";
  if (!vscode2.workspace.workspaceFolders || vscode2.workspace.workspaceFolders.length <= 1) {
    return resolvePath(toolsGopathForWorkspace);
  }
  if (toolsGopathForWorkspace.startsWith("~")) {
    toolsGopathForWorkspace = path3.join(os2.homedir(), toolsGopathForWorkspace.substr(1));
  }
  if (toolsGopathForWorkspace && toolsGopathForWorkspace.trim() && !/\${workspaceRoot}/.test(toolsGopathForWorkspace)) {
    return toolsGopathForWorkspace;
  }
  for (let i = 0; i < vscode2.workspace.workspaceFolders.length; i++) {
    let toolsGopath2 = vscode2.workspace.getConfiguration("go", vscode2.workspace.workspaceFolders[i].uri).inspect("toolsGopath").workspaceFolderValue;
    toolsGopath2 = resolvePath(toolsGopath2, vscode2.workspace.workspaceFolders[i].uri.fsPath);
    if (toolsGopath2) {
      return toolsGopath2;
    }
  }
  return void 0;
}
function resolvePath(inputPath, workspaceRoot) {
  if (!inputPath || !inputPath.trim()) return inputPath;
  if (!workspaceRoot && vscode2.workspace.workspaceFolders) {
    if (vscode2.workspace.workspaceFolders.length === 1) {
      workspaceRoot = vscode2.workspace.rootPath;
    } else if (vscode2.window.activeTextEditor && vscode2.workspace.getWorkspaceFolder(vscode2.window.activeTextEditor.document.uri)) {
      workspaceRoot = vscode2.workspace.getWorkspaceFolder(
        vscode2.window.activeTextEditor.document.uri
      ).uri.fsPath;
    }
  }
  if (workspaceRoot) {
    inputPath = inputPath.replace(/\${workspaceRoot}/g, workspaceRoot).replace(/\${workspaceFolder}/g, workspaceRoot);
  }
  return resolveHomeDir(inputPath);
}
function getTestEnvVars(envFile2, env2, workspaceUri) {
  const envVars = getToolsEnvVars(workspaceUri);
  const testEnvConfig = env2 || {};
  let fileEnv = {};
  if (envFile2) {
    const file = resolvePath(envFile2);
    try {
      fileEnv = parseEnvFile(file);
    } catch (e) {
      console.log(e);
    }
  }
  Object.keys(fileEnv).forEach(
    (key) => envVars[key] = typeof fileEnv[key] === "string" ? resolvePath(fileEnv[key]) : fileEnv[key]
  );
  Object.keys(testEnvConfig).forEach(
    (key) => envVars[key] = typeof testEnvConfig[key] === "string" ? resolvePath(testEnvConfig[key]) : testEnvConfig[key]
  );
  return envVars;
}
function getToolsEnvVars(workspaceUri) {
  const resource = workspaceUri ?? (vscode2.window.activeTextEditor ? vscode2.window.activeTextEditor.document.uri : null);
  const config = vscode2.workspace.getConfiguration("go", resource);
  const toolsEnvVars = config["toolsEnvVars"];
  const gopath = getCurrentGoPath(workspaceUri);
  const envVars = Object.assign({}, process.env, gopath ? { GOPATH: gopath } : {});
  if (toolsEnvVars && typeof toolsEnvVars === "object") {
    Object.keys(toolsEnvVars).forEach(
      (key) => envVars[key] = typeof toolsEnvVars[key] === "string" ? resolvePath(toolsEnvVars[key]) : toolsEnvVars[key]
    );
  }
  const goroot = envVars["GOROOT"];
  let pathEnvVar;
  if (envVars.hasOwnProperty("PATH")) {
    pathEnvVar = "PATH";
  } else if (process.platform === "win32" && envVars.hasOwnProperty("Path")) {
    pathEnvVar = "Path";
  }
  if (goroot && pathEnvVar && envVars[pathEnvVar] && envVars[pathEnvVar].split(path3.delimiter).indexOf(goroot) === -1) {
    envVars[pathEnvVar] += path3.delimiter + path3.join(goroot, "bin");
  }
  return envVars;
}
function getCurrentGoPath(workspaceUri) {
  const config = vscode2.workspace.getConfiguration("go", workspaceUri);
  const currentRoot = workspaceUri ? workspaceUri.fsPath : vscode2.workspace.rootPath;
  const configGopath = config["gopath"] ? resolvePath(config["gopath"], currentRoot) : "";
  return configGopath || process.env["GOPATH"];
}
var LineBuffer = class {
  chunks = [];
  scanChunk = 0;
  scanPos = 0;
  pending = "";
  lineListeners = [];
  lastListeners = [];
  append(chunk) {
    if (chunk.length === 0) {
      return;
    }
    this.chunks.push(chunk);
    this.scan();
  }
  done() {
    const last = this.pending !== "" ? this.pending : null;
    this.pending = "";
    this.fireDone(last);
  }
  /**
   * Reads the lines that the chunks hold.
   */
  scan() {
    while (this.scanChunk < this.chunks.length) {
      const chunk = this.chunks[this.scanChunk];
      const index = chunk.indexOf("\n", this.scanPos);
      if (index === -1) {
        this.pending += chunk.substring(this.scanPos);
        this.scanPos = chunk.length;
        this.scanChunk++;
        continue;
      }
      const text = chunk.substring(this.scanPos, index);
      this.fireLine(this.pending === "" ? text : this.pending + text);
      this.pending = "";
      this.scanPos = index + 1;
      if (this.scanPos >= chunk.length) {
        this.scanChunk++;
        this.scanPos = 0;
      }
    }
    this.compact();
  }
  /**
   * Drops the chunks that have been read, so the array does not grow for
   * the whole life of the buffer.
   */
  compact() {
    if (this.scanChunk === 0) {
      return;
    }
    if (this.scanChunk >= this.chunks.length) {
      this.chunks.length = 0;
      this.scanChunk = 0;
      this.scanPos = 0;
      return;
    }
    if (this.scanChunk * 2 >= this.chunks.length) {
      this.chunks.splice(0, this.scanChunk);
      this.scanChunk = 0;
    }
  }
  fireLine(line) {
    this.lineListeners.forEach((listener) => listener(line));
  }
  fireDone(last) {
    this.lastListeners.forEach((listener) => listener(last));
  }
  onLine(listener) {
    this.lineListeners.push(listener);
  }
  onDone(listener) {
    this.lastListeners.push(listener);
  }
};

// src/lib/testArgs.ts
var DEFAULT_TEST_TIMEOUT = "30s";
function buildRunRegex(testFunctions) {
  return `^(${testFunctions.join("|")})$`;
}
function resolveTestTimeout(configured) {
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  return DEFAULT_TEST_TIMEOUT;
}
function buildTargetArgs(input) {
  if (input.functions) {
    if (input.isBenchmark) {
      return ["-bench", buildRunRegex(input.functions)];
    }
    if (input.functions.length > 0) {
      return ["-run", buildRunRegex(input.functions)];
    }
    return [];
  }
  if (input.isBenchmark) {
    return ["-bench", "."];
  }
  return [];
}

// src/lib/testOutput.ts
var vscode4 = __toESM(require("vscode"));

// src/lib/settings.ts
var vscode3 = __toESM(require("vscode"));

// src/config.ts
var Config = class {
  /**
   * Directory names that are never walked when discovering test files.
   *
   * `vendor` and `testdata` are Go conventions: `vendor` holds a copy of
   * dependencies and `testdata` holds fixtures, neither of which contains
   * tests the user wants to run. The rest are build output and tooling
   * directories that hold no Go source worth scanning.
   */
  static get SkipFolders() {
    return [
      "vendor",
      ".vscode",
      ".git",
      ".idea",
      "node_modules",
      "testdata",
      "dist",
      "build",
      "out",
      "third_party",
      "proto",
      "generated",
      "__pycache__",
      ".venv",
      "coverage"
    ];
  }
  static get RunMaxParallelTest() {
    return 20;
  }
  /**
   * The GOPATH a run uses when the user has not set one.
   *
   * An empty GOPATH means the one Go finds by itself.
   */
  static get DefaultGoPath() {
    return "";
  }
  /**
   * The path of the go binary a run uses when the user has not set one.
   *
   * An empty path means the one on the PATH.
   */
  static get DefaultGoBinary() {
    return "";
  }
  /**
   * The flags that are added to the go test command when the user has not
   * set any.
   */
  static get DefaultTestFlags() {
    return [];
  }
  /**
   * The build tags of a run when the user has not set any.
   */
  static get DefaultBuildTags() {
    return "";
  }
  /**
   * The file that holds the environment variables of a run when the user has
   * not set one.
   */
  static get DefaultEnvFile() {
    return "";
  }
  /**
   * The environment variables of a run when the user has not set any.
   */
  static get DefaultEnv() {
    return {};
  }
  /**
   * Whether the output of a run goes to a terminal when the user has not
   * said otherwise.
   */
  static get RunInTerminal() {
    return true;
  }
  /**
   * The number of directories read at the same time while discovering test
   * files.
   */
  static get DiscoveryConcurrency() {
    return 16;
  }
};

// src/lib/settings.ts
var ownSection = "goTestExplorer";
var goSection = "go";
function userSetValue(inspected) {
  if (!inspected) {
    return void 0;
  }
  if (inspected.workspaceFolderValue !== void 0) {
    return inspected.workspaceFolderValue;
  }
  if (inspected.workspaceValue !== void 0) {
    return inspected.workspaceValue;
  }
  if (inspected.globalValue !== void 0) {
    return inspected.globalValue;
  }
  return void 0;
}
function readSetting(key, goKey, defaultValue, resource) {
  const own = vscode3.workspace.getConfiguration(ownSection, resource);
  const ownValue = userSetValue(own.inspect(key));
  if (ownValue !== void 0) {
    return ownValue;
  }
  if (goKey !== void 0) {
    const goValue = vscode3.workspace.getConfiguration(goSection, resource).get(goKey);
    if (goValue !== void 0) {
      return goValue;
    }
  }
  return defaultValue;
}
function maxParallelTests(resource) {
  const value = readSetting(
    "maxParallelTests",
    void 0,
    Config.RunMaxParallelTest,
    resource
  );
  if (typeof value !== "number" || !isFinite(value) || value < 1) {
    return Config.RunMaxParallelTest;
  }
  return Math.floor(value);
}
function skipFolders(resource) {
  const value = readSetting("skipFolders", void 0, Config.SkipFolders, resource);
  if (!Array.isArray(value)) {
    return Config.SkipFolders;
  }
  const names = value.filter((name) => typeof name === "string" && name.trim() !== "");
  return names.length > 0 ? names : Config.SkipFolders;
}
function goPath(resource) {
  const value = readSetting("goPath", "gopath", Config.DefaultGoPath, resource);
  return typeof value === "string" ? value : Config.DefaultGoPath;
}
function goBinary(resource) {
  const value = readSetting("goBinary", void 0, Config.DefaultGoBinary, resource);
  return typeof value === "string" ? value : Config.DefaultGoBinary;
}
function testFlags(resource) {
  const value = readSetting("testFlags", "testFlags", Config.DefaultTestFlags, resource);
  if (!Array.isArray(value)) {
    return Config.DefaultTestFlags;
  }
  return value.filter((flag) => typeof flag === "string");
}
function buildTags(resource) {
  const value = readSetting("buildTags", "buildTags", Config.DefaultBuildTags, resource);
  return typeof value === "string" ? value : Config.DefaultBuildTags;
}
function timeout(resource) {
  return resolveTestTimeout(readSetting("timeout", "testTimeout", void 0, resource));
}
function envFile(resource) {
  const value = readSetting("envFile", "testEnvFile", Config.DefaultEnvFile, resource);
  return typeof value === "string" ? value : Config.DefaultEnvFile;
}
function env(resource) {
  const value = readSetting(
    "env",
    "testEnvVars",
    Config.DefaultEnv,
    resource
  );
  if (!value || typeof value !== "object") {
    return Config.DefaultEnv;
  }
  return value;
}
function runInTerminal(resource) {
  const value = readSetting("runInTerminal", void 0, Config.RunInTerminal, resource);
  return typeof value === "boolean" ? value : Config.RunInTerminal;
}
function runSettings(resource) {
  return {
    buildTags: buildTags(resource),
    testFlags: testFlags(resource),
    timeout: timeout(resource),
    envFile: envFile(resource),
    env: env(resource)
  };
}

// src/lib/testOutput.ts
var reset = "\x1B[0m";
var red = "\x1B[31m";
var green = "\x1B[32m";
var yellow = "\x1B[33m";
var dim = "\x1B[90m";
var lineColours = [
  { pattern: /^--- FAIL:/, colour: red },
  { pattern: /^--- PASS:/, colour: green },
  { pattern: /^--- SKIP:/, colour: yellow },
  { pattern: /^=== (RUN|PAUSE|CONT)/, colour: dim },
  { pattern: /^FAIL\b/, colour: red },
  { pattern: /^PASS$/, colour: green },
  { pattern: /^ok\s/, colour: green },
  { pattern: /^\?\s/, colour: dim },
  { pattern: /^Error:/, colour: red },
  { pattern: /^Success:/, colour: green },
  { pattern: /^Running tool:/, colour: dim }
];
function decorateLine(line) {
  const match = lineColours.find((candidate) => candidate.pattern.test(line));
  if (!match) {
    return line;
  }
  return match.colour + line + reset;
}
var TestOutput = class {
  /**
   * @param name the name of the terminal.
   */
  constructor(name = "Go Test Explorer") {
    this.name = name;
  }
  name;
  writeEmitter = new vscode4.EventEmitter();
  terminal;
  opened = false;
  buffered = [];
  cancelHandler;
  /**
   * Writes text to the terminal as it is.
   *
   * @param text the text to write.
   */
  write(text) {
    this.ensureTerminal();
    if (this.opened) {
      this.writeEmitter.fire(text);
      return;
    }
    this.buffered.push(text);
  }
  /**
   * Writes a line to the terminal, in the colour that fits it.
   *
   * @param line the line to write.
   */
  writeLine(line) {
    this.write(decorateLine(line) + "\r\n");
  }
  /**
   * Clears the terminal, so the output of the next run is not mixed with
   * the output of the last one.
   */
  clear() {
    if (!this.opened) {
      this.buffered = [];
      return;
    }
    this.write("\x1B[2J\x1B[3J\x1B[H");
  }
  /**
   * Shows the terminal.
   *
   * @param preserveFocus whether the editor keeps the focus.
   */
  show(preserveFocus = true) {
    this.ensureTerminal().show(preserveFocus);
  }
  /**
   * Sets what happens when the user stops the run from the terminal.
   *
   * @param handler the handler, or nothing to leave the terminal alone.
   */
  setCancelHandler(handler) {
    this.cancelHandler = handler;
  }
  /**
   * Disposes of the terminal.
   */
  dispose() {
    this.writeEmitter.dispose();
    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = void 0;
    }
    this.opened = false;
  }
  /**
   * The terminal the output is written to.
   *
   * The terminal is made when it is first needed, so the extension does
   * not open a terminal of its own when it starts.
   */
  ensureTerminal() {
    if (!this.terminal) {
      const pty = {
        onDidWrite: this.writeEmitter.event,
        open: () => {
          this.opened = true;
          const buffered = this.buffered.join("");
          this.buffered = [];
          if (buffered) {
            this.writeEmitter.fire(buffered);
          }
        },
        close: () => {
          this.opened = false;
        },
        handleInput: (data) => {
          if (data === "") {
            const handler = this.cancelHandler;
            if (handler) {
              handler();
            }
          }
        }
      };
      this.terminal = vscode4.window.createTerminal({ name: this.name, pty });
    }
    return this.terminal;
  }
};
var ChannelOutput = class {
  /**
   * @param name the name of the channel.
   */
  constructor(name = "Go Test Explorer") {
    this.name = name;
  }
  name;
  channel;
  /**
   * Writes text to the channel as it is.
   *
   * @param text the text to write.
   */
  write(text) {
    this.ensureChannel().append(text);
  }
  /**
   * Writes a line to the channel, in the colour that fits it.
   *
   * @param line the line to write.
   */
  writeLine(line) {
    this.ensureChannel().appendLine(decorateLine(line));
  }
  /**
   * Clears the channel, so the output of the next run is not mixed with the
   * output of the last one.
   */
  clear() {
    this.ensureChannel().clear();
  }
  /**
   * Shows the channel.
   *
   * @param preserveFocus whether the editor keeps the focus.
   */
  show(preserveFocus = true) {
    this.ensureChannel().show(preserveFocus);
  }
  /**
   * Disposes of the channel.
   */
  dispose() {
    if (this.channel) {
      this.channel.dispose();
      this.channel = void 0;
    }
  }
  /**
   * The channel the output is written to.
   */
  ensureChannel() {
    if (!this.channel) {
      this.channel = vscode4.window.createOutputChannel(this.name);
    }
    return this.channel;
  }
};
var TestOutputFacade = class {
  terminal = new TestOutput("Go Test Explorer");
  channel = new ChannelOutput("Go Test Explorer");
  /**
   * Writes text as it is.
   *
   * @param text the text to write.
   */
  write(text) {
    this.sink().write(text);
  }
  /**
   * Writes a line, in the colour that fits it.
   *
   * @param line the line to write.
   */
  writeLine(line) {
    this.sink().writeLine(line);
  }
  /**
   * Clears the output, so the output of the next run is not mixed with the
   * output of the last one.
   */
  clear() {
    this.sink().clear();
  }
  /**
   * Shows the output.
   *
   * @param preserveFocus whether the editor keeps the focus.
   */
  show(preserveFocus = true) {
    this.sink().show(preserveFocus);
  }
  /**
   * Sets what happens when the user stops the run from the terminal.
   *
   * @param handler the handler, or nothing to leave the terminal alone.
   */
  setCancelHandler(handler) {
    this.terminal.setCancelHandler(handler);
  }
  /**
   * Disposes of the output.
   */
  dispose() {
    this.terminal.dispose();
    this.channel.dispose();
  }
  /**
   * Where the output goes.
   */
  sink() {
    return runInTerminal() ? this.terminal : this.channel;
  }
};
var testOutput = new TestOutputFacade();

// src/rawTestResult.ts
var RawTestResult = class {
  constructor(isPassed, output, failedTests, err, packages = /* @__PURE__ */ new Map()) {
    this.isPassed = isPassed;
    this.output = output;
    this.failedTests = failedTests;
    this.err = err;
    this.packages = packages;
  }
  isPassed;
  output;
  failedTests;
  err;
  packages;
};

// src/exec/goTestJsonParser.ts
var GoTestJsonParser = class {
  /** The part of a line that has not been read yet. */
  buffer = "";
  /** What is known about every package seen so far. */
  packages = /* @__PURE__ */ new Map();
  /** The ordinary output of the run. */
  outputLines = [];
  /** The build errors of the run. */
  buildOutputLines = [];
  /** Whether a package failed to build. */
  buildFailed = false;
  /**
   * Reads a chunk of the stream.
   *
   * @param chunk the text the process wrote.
   * @returns the output the chunk produced.
   */
  write(chunk) {
    this.buffer += chunk;
    const output = [];
    const buildOutput = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.substring(0, newline);
      this.buffer = this.buffer.substring(newline + 1);
      this.handleLine(line, output, buildOutput);
      newline = this.buffer.indexOf("\n");
    }
    return { output, buildOutput };
  }
  /**
   * Reads whatever is left of the stream, once the process has closed it.
   *
   * @returns the output the last part produced.
   */
  end() {
    const output = [];
    const buildOutput = [];
    const rest = this.buffer;
    this.buffer = "";
    if (rest.length > 0) {
      this.handleLine(rest, output, buildOutput);
    }
    return { output, buildOutput };
  }
  /** What the run produced so far. */
  get results() {
    const packages = /* @__PURE__ */ new Map();
    const failedPackages = [];
    this.packages.forEach((builder, name) => {
      const tests = /* @__PURE__ */ new Map();
      const failedTests = [];
      builder.tests.forEach((outcome, testName) => {
        tests.set(testName, outcome);
        if (outcome.action === "fail") {
          failedTests.push(testName);
        }
      });
      if (builder.failed) {
        failedPackages.push(name);
      }
      packages.set(name, {
        package: name,
        tests,
        failedTests,
        output: builder.output.slice(),
        failed: builder.failed,
        buildFailed: builder.buildFailed
      });
    });
    return {
      packages,
      output: this.outputLines.slice(),
      buildOutput: this.buildOutputLines.slice(),
      failedPackages,
      buildFailed: this.buildFailed
    };
  }
  /**
   * Reads one line of the stream.
   */
  handleLine(line, output, buildOutput) {
    const event = parseEvent(line);
    if (!event) {
      this.outputLines.push(line);
      output.push(line);
      return;
    }
    switch (event.Action) {
      case "output": {
        const lines = splitLines(event.Output);
        this.outputLines.push(...lines);
        output.push(...lines);
        if (event.Package) {
          this.packageFor(event.Package).output.push(...lines);
        }
        if (event.Test && event.Package) {
          this.outcomeFor(event.Package, event.Test).output.push(...lines);
        }
        return;
      }
      case "build-output": {
        const lines = splitLines(event.Output);
        this.buildOutputLines.push(...lines);
        buildOutput.push(...lines);
        return;
      }
      case "build-fail": {
        this.buildFailed = true;
        const buildFailed = packageOfBuildFailure(event.ImportPath);
        if (buildFailed) {
          this.packageFor(buildFailed).buildFailed = true;
        }
        return;
      }
      case "run": {
        if (event.Test && event.Package) {
          this.outcomeFor(event.Package, event.Test);
        }
        return;
      }
      case "pass":
      case "fail":
      case "skip": {
        if (event.Test && event.Package) {
          const outcome = this.outcomeFor(event.Package, event.Test);
          outcome.action = event.Action;
          outcome.elapsed = event.Elapsed ?? outcome.elapsed;
        } else if (event.Action === "fail" && event.Package) {
          const pkg = this.packageFor(event.Package);
          pkg.failed = true;
          if (event.FailedBuild) {
            pkg.buildFailed = true;
          }
        }
        return;
      }
      default:
        return;
    }
  }
  /**
   * What is known about a package, created the first time the package is
   * seen.
   */
  packageFor(name) {
    let pkg = this.packages.get(name);
    if (!pkg) {
      pkg = { package: name, tests: /* @__PURE__ */ new Map(), output: [], failed: false, buildFailed: false };
      this.packages.set(name, pkg);
    }
    return pkg;
  }
  /**
   * The outcome of a test, created the first time the test is seen.
   */
  outcomeFor(packageName, name) {
    const pkg = this.packageFor(packageName);
    let outcome = pkg.tests.get(name);
    if (!outcome) {
      outcome = { name, action: "run", elapsed: 0, output: [] };
      pkg.tests.set(name, outcome);
    }
    return outcome;
  }
};
function packageOfBuildFailure(importPath) {
  if (!importPath) {
    return void 0;
  }
  const separator = importPath.indexOf(" ");
  return separator > 0 ? importPath.substring(0, separator) : importPath;
}
function hasFailed(failedTests, testName) {
  const prefix = testName + "/";
  return failedTests.some((failed) => failed === testName || failed.startsWith(prefix));
}
function parseEvent(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed[0] !== "{") {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const event = parsed;
  if (typeof event["Action"] !== "string") {
    return null;
  }
  return {
    Action: event["Action"],
    Package: typeof event["Package"] === "string" ? event["Package"] : void 0,
    Test: typeof event["Test"] === "string" ? event["Test"] : void 0,
    Output: typeof event["Output"] === "string" ? event["Output"] : void 0,
    Elapsed: typeof event["Elapsed"] === "number" ? event["Elapsed"] : void 0,
    FailedBuild: typeof event["FailedBuild"] === "string" ? event["FailedBuild"] : void 0,
    ImportPath: typeof event["ImportPath"] === "string" ? event["ImportPath"] : void 0
  };
}
function splitLines(text) {
  if (!text) {
    return [];
  }
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

// src/lib/testUtil.ts
var cp2 = require("child_process");
var fs2 = require("fs");
var path4 = require("path");
var sendSignal = "SIGKILL";
var runningTestProcesses = [];
function cancelRunningTests() {
  const processes = runningTestProcesses.slice();
  processes.forEach((child) => killProcessTree(child));
  return processes.length;
}
function killProcessTree(child, signal = sendSignal) {
  if (child.pid === void 0) {
    return;
  }
  if (process.platform === "win32") {
    try {
      cp2.execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } catch (e) {
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (e) {
    try {
      child.kill(signal);
    } catch (e2) {
    }
  }
}
function getBinPath(tool) {
  return getBinPathWithPreferredGopath(
    tool,
    tool === "go" ? [] : [getToolsGopath(), getCurrentGoPath()],
    vscode5.workspace.getConfiguration("go", null).get("alternateTools")
  );
}
function getGoBinaryPath(resource) {
  const binary = goBinary(resource);
  if (binary) {
    return resolveHomeDir(binary);
  }
  const gopath = goPath(resource);
  if (gopath) {
    const fromGopath = getBinPathFromEnvVar("go", resolveHomeDir(gopath), true);
    if (fromGopath) {
      return fromGopath;
    }
  }
  return getBinPath("go");
}
function isToolAvailable(tool) {
  const binPath = getBinPath(tool);
  if (!binPath) {
    return false;
  }
  if (path4.isAbsolute(binPath)) {
    try {
      return fs2.statSync(binPath).isFile();
    } catch (e) {
      return false;
    }
  }
  return getBinPathFromEnvVar(tool, envPath, false) !== null;
}
function runGoTest(testconfig, token) {
  return new Promise((resolve, reject) => {
    if (runningTestProcesses.length < 1) {
      testOutput.clear();
    }
    if (!testconfig.background) {
      testOutput.show(true);
    }
    const buildTags2 = testconfig.settings.buildTags;
    const testFlags2 = testconfig.settings.testFlags || [];
    const args = ["test", "-json", ...testconfig.flags];
    const testType = testconfig.isBenchmark ? "Benchmarks" : "Tests";
    if (testconfig.isBenchmark) {
      args.push("-benchmem", "-run=^$");
    } else {
      args.push("-timeout", testconfig.settings.timeout);
    }
    if (buildTags2 && testconfig.flags.indexOf("-tags") === -1) {
      args.push("-tags", buildTags2);
    }
    testFlags2.forEach((flag) => args.push(flag));
    const testEnvVars = getTestEnvVars(
      testconfig.settings.envFile,
      testconfig.settings.env,
      testconfig.testUri
    );
    const goRuntimePath = getGoBinaryPath(testconfig.testUri);
    if (!goRuntimePath) {
      const message = 'Cannot find "go" binary. Update PATH or GOROOT appropriately';
      vscode5.window.showInformationMessage(message);
      testOutput.writeLine(`Error: ${testType} failed.`);
      testOutput.writeLine(message);
      resolve(new RawTestResult(false, [], [], new Error(message)));
      return;
    }
    targetArgs(testconfig).then(
      (targets) => {
        const outTargets = args.slice(0);
        if (targets.length > 4) {
          outTargets.push("<long arguments omitted>");
        } else {
          outTargets.push(...targets);
        }
        testOutput.writeLine(["Running tool:", goRuntimePath, ...outTargets].join(" "));
        if (!testconfig.isBenchmark) {
          testOutput.writeLine(`Timeout: ${testconfig.settings.timeout}`);
        }
        testOutput.writeLine("");
        args.push(...targets);
        const detached = process.platform !== "win32";
        const tp = cp2.spawn(goRuntimePath, args, {
          env: testEnvVars,
          cwd: testconfig.dir,
          detached
        });
        const parser = new GoTestJsonParser();
        const errBuf = new LineBuffer();
        if (token) {
          if (token.isCancellationRequested) {
            killProcessTree(tp);
          } else {
            token.onCancellationRequested(() => killProcessTree(tp));
          }
        }
        tp.stdout.on("data", (chunk) => {
          const parsed = parser.write(chunk.toString());
          parsed.output.forEach((line) => testOutput.writeLine(line));
          parsed.buildOutput.forEach(
            (line) => testOutput.writeLine(expandFilePathInOutputLine(line, testconfig.dir))
          );
        });
        errBuf.onLine(
          (line) => testOutput.writeLine(expandFilePathInOutputLine(line, testconfig.dir))
        );
        errBuf.onDone(
          (last) => last && testOutput.writeLine(expandFilePathInOutputLine(last, testconfig.dir))
        );
        tp.stderr.on("data", (chunk) => errBuf.append(chunk.toString()));
        tp.on("close", (code, signal) => {
          const parsed = parser.end();
          parsed.output.forEach((line) => testOutput.writeLine(line));
          parsed.buildOutput.forEach(
            (line) => testOutput.writeLine(expandFilePathInOutputLine(line, testconfig.dir))
          );
          errBuf.done();
          if (code) {
            testOutput.writeLine(`Error: ${testType} failed.`);
          } else if (signal === sendSignal) {
            testOutput.writeLine(`Error: ${testType} terminated by user.`);
          } else {
            testOutput.writeLine(`Success: ${testType} passed.`);
          }
          const index = runningTestProcesses.indexOf(tp, 0);
          if (index > -1) {
            runningTestProcesses.splice(index, 1);
          }
          const results = parser.results;
          const output = results.buildOutput.concat(results.output);
          const failedTests = [];
          results.packages.forEach((pkg) => failedTests.push(...pkg.failedTests));
          resolve(new RawTestResult(code === 0, output, failedTests, void 0, results.packages));
        });
        runningTestProcesses.push(tp);
      },
      (err) => {
        testOutput.writeLine(`Error: ${testType} failed.`);
        testOutput.writeLine(err);
        resolve(new RawTestResult(false, [], err));
      }
    );
  });
}
var goFileInOutput = /(\S+\.go):(\d+):/g;
function expandFilePathInOutputLine(line, cwd) {
  return line.replace(goFileInOutput, (match, file, lineNumber) => {
    if (path4.isAbsolute(file)) {
      return match;
    }
    return path4.join(cwd, file) + ":" + lineNumber + ":";
  });
}
function targetArgs(testconfig) {
  if (testconfig.packages && testconfig.packages.length > 0) {
    return Promise.resolve(
      testconfig.packages.map((pkg) => pkg.path === "" ? "." : "./" + pkg.path)
    );
  }
  return Promise.resolve(
    buildTargetArgs({
      functions: testconfig.functions,
      isBenchmark: testconfig.isBenchmark
    })
  );
}

// src/commands.ts
var import_vscode = require("vscode");
var Commands = class {
  onTestDiscoveryFinishedEmitter = new import_vscode.EventEmitter();
  onTestDiscoveryStartedEmitter = new import_vscode.EventEmitter();
  onTestRunStartedEmitter = new import_vscode.EventEmitter();
  onTestResultEmitter = new import_vscode.EventEmitter();
  onTestCompletedEmitter = new import_vscode.EventEmitter();
  onTestFileChangedEmitter = new import_vscode.EventEmitter();
  onTestFileRemovedEmitter = new import_vscode.EventEmitter();
  get discoveredTest() {
    return this.onTestDiscoveryFinishedEmitter.event;
  }
  sendDiscoveredTests(testNodeList) {
    this.onTestDiscoveryFinishedEmitter.fire(testNodeList);
  }
  get testDiscoveryStarted() {
    return this.onTestDiscoveryStartedEmitter.event;
  }
  sendTestDiscoveryStarted() {
    this.onTestDiscoveryStartedEmitter.fire();
  }
  /**
   * The tests that are about to run.
   *
   * Every test of a run is reported in one event, so the tree is redrawn
   * once for the whole run rather than once per test.
   */
  get testRunStarted() {
    return this.onTestRunStartedEmitter.event;
  }
  sendTestRunStarted(testNodes) {
    this.onTestRunStartedEmitter.fire(testNodes);
  }
  get testResult() {
    return this.onTestResultEmitter.event;
  }
  sendTestResult(testResult) {
    this.onTestResultEmitter.fire(testResult);
  }
  /**
   * The run that covers the given files has finished, so the tree can be
   * redrawn once with the outcome of every test of that run.
   *
   * A run that tests one file names one URI. A run that tests several
   * packages names every file it covered, so that the tree is redrawn once
   * for all of them.
   */
  get testCompleted() {
    return this.onTestCompletedEmitter.event;
  }
  sendTestCompleted(testUris) {
    this.onTestCompletedEmitter.fire(testUris);
  }
  /**
   * The tests in one file changed, so the node for that file is replaced
   * without rebuilding the rest of the tree.
   */
  get testFileChanged() {
    return this.onTestFileChangedEmitter.event;
  }
  sendTestFileChanged(testNode) {
    this.onTestFileChangedEmitter.fire(testNode);
  }
  /**
   * A file that held tests is gone, so its node is dropped.
   */
  get testFileRemoved() {
    return this.onTestFileRemovedEmitter.event;
  }
  sendTestFileRemoved(filePath) {
    this.onTestFileRemovedEmitter.fire(filePath);
  }
};

// src/testResult.ts
var TestResult = class {
  constructor(uri, testName, isPassed, output, error) {
    this.uri = uri;
    this.testName = testName;
    this.isPassed = isPassed;
    this.output = output;
    this.error = error;
  }
  uri;
  testName;
  isPassed;
  output;
  error;
};

// src/testDiscovery.ts
var path6 = __toESM(require("path"));
var fs6 = __toESM(require("fs"));
var vscode6 = __toESM(require("vscode"));

// src/discovery/fileWalker.ts
var fs3 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var TEST_FILE_SUFFIX = "_test.go";
async function findTestFiles(root, options) {
  const skip = new Set(options.skipFolders);
  const concurrency = Math.max(1, options.concurrency);
  const files = [];
  const directories = [root];
  const visited = /* @__PURE__ */ new Set();
  const rootRealPath = await realPathOf(root);
  if (rootRealPath) {
    visited.add(rootRealPath);
  }
  const worker = async () => {
    while (directories.length > 0) {
      const directory = directories.shift();
      let entries;
      try {
        entries = await fs3.promises.readdir(directory, { withFileTypes: true });
      } catch (e) {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path5.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) {
            directories.push(fullPath);
          }
          continue;
        }
        if (entry.isSymbolicLink()) {
          const resolved = await resolveLink(fullPath);
          if (!resolved) {
            continue;
          }
          if (resolved.isDirectory) {
            if (!skip.has(entry.name) && !visited.has(resolved.realPath)) {
              visited.add(resolved.realPath);
              directories.push(fullPath);
            }
            continue;
          }
          if (resolved.isFile && entry.name.endsWith(TEST_FILE_SUFFIX)) {
            files.push(fullPath);
          }
          continue;
        }
        if (entry.isFile() && entry.name.endsWith(TEST_FILE_SUFFIX)) {
          files.push(fullPath);
        }
      }
    }
  };
  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return files;
}
function isInSkippedFolder(filePath, skipFolders2) {
  if (skipFolders2.length === 0) {
    return false;
  }
  const skip = new Set(skipFolders2);
  return path5.dirname(filePath).split(path5.sep).some((segment) => skip.has(segment));
}
async function realPathOf(target) {
  try {
    return await fs3.promises.realpath(target);
  } catch (e) {
    return null;
  }
}
async function resolveLink(linkPath) {
  try {
    const stats = await fs3.promises.stat(linkPath);
    return {
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      realPath: await fs3.promises.realpath(linkPath)
    };
  } catch (e) {
    return null;
  }
}

// src/discovery/goScanner.ts
var fs4 = __toESM(require("fs"));
var CHAR_TAB = 9;
var CHAR_NEWLINE = 10;
var CHAR_CARRIAGE_RETURN = 13;
var CHAR_SPACE = 32;
var CHAR_QUOTE = 34;
var CHAR_APOSTROPHE = 39;
var CHAR_OPEN_PAREN = 40;
var CHAR_CLOSE_PAREN = 41;
var CHAR_ASTERISK = 42;
var CHAR_SLASH = 47;
var CHAR_BACKSLASH = 92;
var CHAR_ZERO = 48;
var CHAR_NINE = 57;
var CHAR_UPPER_A = 65;
var CHAR_UPPER_Z = 90;
var CHAR_UNDERSCORE = 95;
var CHAR_BACKTICK = 96;
var CHAR_LOWER_A = 97;
var CHAR_LOWER_F = 102;
var CHAR_LOWER_Z = 122;
var CHAR_OPEN_BRACKET = 91;
var CHAR_CLOSE_BRACKET = 93;
var CHAR_OPEN_BRACE = 123;
var CHAR_CLOSE_BRACE = 125;
function isIdentStart(code) {
  return code >= CHAR_UPPER_A && code <= CHAR_UPPER_Z || code >= CHAR_LOWER_A && code <= CHAR_LOWER_Z || code === CHAR_UNDERSCORE;
}
function isIdentPart(code) {
  return isIdentStart(code) || code >= CHAR_ZERO && code <= CHAR_NINE;
}
function charCodeAt(text, index) {
  return index >= 0 && index < text.length ? text.charCodeAt(index) : 0;
}
function skipSpace(text, index) {
  let i = index;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === CHAR_SPACE || code === CHAR_TAB || code === CHAR_NEWLINE || code === CHAR_CARRIAGE_RETURN) {
      i++;
      continue;
    }
    break;
  }
  return i;
}
function skipInterpretedString(text, index) {
  let i = index + 1;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === CHAR_BACKSLASH) {
      i += 2;
      continue;
    }
    if (code === CHAR_NEWLINE) {
      return -1;
    }
    if (code === CHAR_QUOTE) {
      return i + 1;
    }
    i++;
  }
  return -1;
}
function skipRune(text, index) {
  let i = index + 1;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === CHAR_BACKSLASH) {
      i += 2;
      continue;
    }
    if (code === CHAR_NEWLINE) {
      return -1;
    }
    if (code === CHAR_APOSTROPHE) {
      return i + 1;
    }
    i++;
  }
  return -1;
}
function matchBracket(text, index, open, close) {
  let depth = 0;
  let i = index;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === CHAR_SLASH) {
      const next = charCodeAt(text, i + 1);
      if (next === CHAR_SLASH) {
        const end = text.indexOf("\n", i + 2);
        i = end === -1 ? text.length : end + 1;
        continue;
      }
      if (next === CHAR_ASTERISK) {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) {
          return -1;
        }
        i = end + 2;
        continue;
      }
      i++;
      continue;
    }
    if (code === CHAR_QUOTE) {
      const end = skipInterpretedString(text, i);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }
    if (code === CHAR_BACKTICK) {
      const end = text.indexOf("`", i + 1);
      if (end === -1) {
        return -1;
      }
      i = end + 1;
      continue;
    }
    if (code === CHAR_APOSTROPHE) {
      const end = skipRune(text, i);
      if (end === -1) {
        return -1;
      }
      i = end;
      continue;
    }
    if (code === open) {
      depth++;
    } else if (code === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}
function parseFuncDecl(text, funcOffset) {
  let i = skipSpace(text, funcOffset + 4);
  let hasReceiver = false;
  if (charCodeAt(text, i) === CHAR_OPEN_PAREN) {
    hasReceiver = true;
    const end = matchBracket(text, i, CHAR_OPEN_PAREN, CHAR_CLOSE_PAREN);
    if (end === -1) {
      return null;
    }
    i = skipSpace(text, end + 1);
  }
  if (!isIdentStart(charCodeAt(text, i))) {
    return null;
  }
  const nameStart = i;
  while (isIdentPart(charCodeAt(text, i))) {
    i++;
  }
  const name = text.substring(nameStart, i);
  if (hasReceiver) {
    return null;
  }
  if (!name.startsWith("Test")) {
    return null;
  }
  i = skipSpace(text, i);
  if (charCodeAt(text, i) === CHAR_OPEN_BRACKET) {
    const end = matchBracket(text, i, CHAR_OPEN_BRACKET, CHAR_CLOSE_BRACKET);
    if (end === -1) {
      return null;
    }
    i = skipSpace(text, end + 1);
  }
  if (charCodeAt(text, i) !== CHAR_OPEN_PAREN) {
    return null;
  }
  const paramsEnd = matchBracket(text, i, CHAR_OPEN_PAREN, CHAR_CLOSE_PAREN);
  if (paramsEnd === -1) {
    return null;
  }
  const params = text.substring(i + 1, paramsEnd);
  return {
    decl: {
      name,
      nameOffset: nameStart,
      usesTesting: /testing\.[TBF]\b/.test(params)
    },
    resumeAt: nameStart + name.length
  };
}
function buildLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === CHAR_NEWLINE) {
      starts.push(i + 1);
    }
  }
  return starts;
}
function lineAndColumn(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { line: low, column: offset - lineStarts[low] };
}
function scanGoSource(text) {
  const raw = [];
  let i = 0;
  let depth = 0;
  let confident = true;
  let reason;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === CHAR_SLASH) {
      const next = charCodeAt(text, i + 1);
      if (next === CHAR_SLASH) {
        const end = text.indexOf("\n", i + 2);
        i = end === -1 ? text.length : end + 1;
        continue;
      }
      if (next === CHAR_ASTERISK) {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) {
          confident = false;
          reason = "unterminated block comment";
          break;
        }
        i = end + 2;
        continue;
      }
      i++;
      continue;
    }
    if (code === CHAR_QUOTE) {
      const end = skipInterpretedString(text, i);
      if (end === -1) {
        confident = false;
        reason = "unterminated string literal";
        break;
      }
      i = end;
      continue;
    }
    if (code === CHAR_BACKTICK) {
      const end = text.indexOf("`", i + 1);
      if (end === -1) {
        confident = false;
        reason = "unterminated raw string literal";
        break;
      }
      i = end + 1;
      continue;
    }
    if (code === CHAR_APOSTROPHE) {
      const end = skipRune(text, i);
      if (end === -1) {
        confident = false;
        reason = "unterminated rune literal";
        break;
      }
      i = end;
      continue;
    }
    if (code === CHAR_OPEN_BRACE) {
      depth++;
      i++;
      continue;
    }
    if (code === CHAR_CLOSE_BRACE) {
      if (depth > 0) {
        depth--;
      }
      i++;
      continue;
    }
    if (code === CHAR_LOWER_F && depth === 0 && text.startsWith("func", i) && !isIdentPart(charCodeAt(text, i - 1)) && !isIdentPart(charCodeAt(text, i + 4))) {
      const parsed = parseFuncDecl(text, i);
      if (parsed) {
        raw.push(parsed.decl);
        i = parsed.resumeAt;
        continue;
      }
      i += 4;
      continue;
    }
    i++;
  }
  if (confident && depth !== 0) {
    confident = false;
    reason = "unbalanced braces";
  }
  const lineStarts = buildLineIndex(text);
  const declarations = raw.map((decl) => {
    const { line, column } = lineAndColumn(lineStarts, decl.nameOffset);
    return {
      name: decl.name,
      line,
      startChar: column,
      endChar: column + decl.name.length,
      usesTesting: decl.usesTesting
    };
  });
  return { declarations, confident, reason };
}
async function scanGoFile(filePath) {
  const text = await fs4.promises.readFile(filePath, "utf8");
  return scanGoSource(text);
}

// src/discovery/discover.ts
async function discoverTests(root, options) {
  const files = await findTestFiles(root, {
    skipFolders: options?.skipFolders ?? skipFolders(),
    concurrency: Config.DiscoveryConcurrency
  });
  const cache = options?.cache;
  const suites = await mapWithConcurrency(
    files,
    Config.DiscoveryConcurrency,
    async (file) => {
      try {
        const scan = cache ? await cache.scan(file) : await scanGoFile(file);
        return {
          file,
          declarations: scan.declarations,
          confident: scan.confident,
          reason: scan.reason
        };
      } catch (e) {
        return null;
      }
    }
  );
  return suites.filter((suite) => suite !== null);
}
async function mapWithConcurrency(items, concurrency, action) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await action(items[index]);
    }
  };
  const workers = [];
  const limit = Math.min(Math.max(1, concurrency), items.length);
  for (let i = 0; i < limit; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// src/discovery/scanCache.ts
var fs5 = __toESM(require("fs"));
var ScanCache = class {
  entries = /* @__PURE__ */ new Map();
  /**
   * Scans a file, reusing the cached result when the file has not changed.
   *
   * @param file the path of the file to scan.
   * @returns the test declarations in the file.
   */
  async scan(file) {
    const stats = await statOf(file);
    const cached = this.entries.get(file);
    if (cached && stats && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached;
    }
    const scan = await scanGoFile(file);
    const entry = {
      declarations: scan.declarations,
      confident: scan.confident,
      reason: scan.reason,
      mtimeMs: stats ? stats.mtimeMs : -1,
      size: stats ? stats.size : -1
    };
    this.entries.set(file, entry);
    return entry;
  }
  /**
   * Forgets the cached result of a file, so that it is read again the next
   * time it is scanned.
   *
   * @param file the path of the file to forget.
   */
  invalidate(file) {
    this.entries.delete(file);
  }
  /** Forgets every cached result. */
  clear() {
    this.entries.clear();
  }
  /** The number of files currently held in the cache. */
  get size() {
    return this.entries.size;
  }
};
async function statOf(file) {
  try {
    const stats = await fs5.promises.stat(file);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch (e) {
    return null;
  }
}

// src/testDiscovery.ts
var TestDiscovery = class {
  constructor(commands2, context) {
    this.commands = commands2;
    this.context = context;
    this.watchForTestFiles();
  }
  commands;
  context;
  cache = new ScanCache();
  /**
   * The workspace folders that are on the file system. A changed file
   * outside them is not ours to react to.
   */
  workspaceFolders = [];
  /**
   * The directories that are actually scanned. A folder with a `src`
   * directory is scanned from there, so a test file elsewhere in the
   * workspace is not part of the tree.
   */
  roots = [];
  /**
   * The files that changed while a discovery was running. They are applied
   * once that discovery has finished, so an edit made during the first
   * scan is not lost.
   */
  pendingChanges = /* @__PURE__ */ new Set();
  /**
   * The number of changes seen for a file. A scan that has been overtaken
   * by a newer one is discarded rather than reported.
   */
  changeVersions = /* @__PURE__ */ new Map();
  /**
   * False until the first discovery has finished.
   */
  discovered = false;
  discoverAllTests() {
    this.commands.sendTestDiscoveryStarted();
    const workspaceFolders = (vscode6.workspace.workspaceFolders || []).filter(
      (folder) => folder.uri.scheme === "file"
    );
    this.workspaceFolders = workspaceFolders.map((folder) => folder.uri.fsPath);
    this.roots = [];
    this.discovered = false;
    if (workspaceFolders.length === 0) {
      this.commands.sendDiscoveredTests([]);
      this.discovered = true;
      this.applyPendingChanges();
      return;
    }
    Promise.all(workspaceFolders.map((folder) => this.discoverFolderTests(folder.uri))).then((results) => {
      this.commands.sendDiscoveredTests([].concat(...results));
      this.discovered = true;
      this.applyPendingChanges();
    }).catch((err) => {
      vscode6.window.showErrorMessage("An error occurred: " + err);
      this.commands.sendDiscoveredTests([]);
      this.discovered = true;
      this.applyPendingChanges();
    });
  }
  /**
   * Discovers the tests under a single workspace folder. A folder with a
   * `src` directory is scanned from there, otherwise from the folder root.
   */
  async discoverFolderTests(folderUri) {
    const srcLocation = path6.join(folderUri.fsPath, "src");
    const root = await directoryExists(srcLocation) ? srcLocation : folderUri.fsPath;
    this.roots.push(root);
    return this.discoverTests(vscode6.Uri.file(root));
  }
  async discoverTests(uri) {
    const suites = await discoverTests(uri.fsPath, { cache: this.cache });
    return suites.map((suite) => {
      this.warnIfUnconfident(suite);
      return this.buildSuiteNode(suite.file, suite.declarations);
    });
  }
  /**
   * Builds the tree node for one test file.
   *
   * A file with no test functions still gets a node, so that the tree
   * shows that the file was seen and found to hold nothing runnable.
   */
  buildSuiteNode(file, declarations) {
    const uri = vscode6.Uri.file(file);
    const sorted = declarations.slice().sort((a, b) => a.name.localeCompare(b.name));
    const children = sorted.map((declaration) => new TestNode(declaration.name, uri));
    return new TestNode(path6.basename(file), uri, children);
  }
  /**
   * Reports a file that could not be scanned with confidence.
   *
   * Such a file is broken Go, so it is reported rather than quietly listed
   * with fewer tests than it declares.
   */
  warnIfUnconfident(suite) {
    if (!suite.confident) {
      console.warn(
        `go-test-explorer: ${suite.file} could not be scanned (${suite.reason}); the tests it declares may be missing.`
      );
    }
  }
  /**
   * Watches the workspace for test files, so that a change is reflected in
   * the tree without a manual refresh.
   */
  watchForTestFiles() {
    const watcher = vscode6.workspace.createFileSystemWatcher("**/*_test.go");
    watcher.onDidCreate((uri) => this.onTestFileChanged(uri));
    watcher.onDidChange((uri) => this.onTestFileChanged(uri));
    watcher.onDidDelete((uri) => this.onTestFileRemoved(uri));
    this.context.subscriptions.push(watcher);
  }
  /**
   * A test file was created or changed. Only that file is scanned, so the
   * tree is updated without a walk of the whole workspace.
   */
  async onTestFileChanged(uri) {
    const filePath = uri.fsPath;
    if (!this.isInWorkspace(filePath)) {
      return;
    }
    if (!this.discovered) {
      this.pendingChanges.add(filePath);
      return;
    }
    if (!this.isInScope(filePath)) {
      return;
    }
    const version = this.nextVersion(filePath);
    this.cache.invalidate(filePath);
    try {
      const scan = await this.cache.scan(filePath);
      if (this.changeVersions.get(filePath) !== version) {
        this.cache.invalidate(filePath);
        return;
      }
      this.warnIfUnconfident({
        file: filePath,
        declarations: scan.declarations,
        confident: scan.confident,
        reason: scan.reason
      });
      this.commands.sendTestFileChanged(this.buildSuiteNode(filePath, scan.declarations));
    } catch (e) {
      this.commands.sendTestFileRemoved(filePath);
    }
  }
  /**
   * A test file was deleted, so it leaves the tree.
   */
  onTestFileRemoved(uri) {
    const filePath = uri.fsPath;
    if (!this.isInWorkspace(filePath)) {
      return;
    }
    this.cache.invalidate(filePath);
    if (!this.discovered) {
      this.pendingChanges.add(filePath);
      return;
    }
    if (!this.isInScope(filePath)) {
      return;
    }
    this.commands.sendTestFileRemoved(filePath);
  }
  /**
   * Applies the changes that arrived while a discovery was running.
   */
  applyPendingChanges() {
    const pending = Array.from(this.pendingChanges);
    this.pendingChanges.clear();
    pending.forEach((filePath) => this.onTestFileChanged(vscode6.Uri.file(filePath)));
  }
  /**
   * Whether a file is inside the workspace at all.
   */
  isInWorkspace(filePath) {
    return this.workspaceFolders.some((folder) => isUnder(folder, filePath));
  }
  /**
   * Whether a file is part of the tree: inside a directory that is
   * scanned, and not inside a directory that is skipped.
   */
  isInScope(filePath) {
    if (isInSkippedFolder(filePath, skipFolders())) {
      return false;
    }
    return this.roots.some((root) => isUnder(root, filePath));
  }
  /**
   * Numbers a change to a file, so that a scan that has been overtaken by
   * a newer one can be recognised and discarded.
   */
  nextVersion(filePath) {
    const version = (this.changeVersions.get(filePath) || 0) + 1;
    this.changeVersions.set(filePath, version);
    return version;
  }
};
function isUnder(root, filePath) {
  if (filePath === root) {
    return true;
  }
  const relative3 = path6.relative(root, filePath);
  return relative3.length > 0 && !relative3.startsWith("..") && !path6.isAbsolute(relative3);
}
function directoryExists(target) {
  return new Promise((resolve) => {
    fs6.stat(target, (err, stat2) => resolve(!err && stat2.isDirectory()));
  });
}

// src/runner/testQueue.ts
var TestQueue = class {
  /**
   * @param run executes a single test invocation.
   * @param maxParallel the maximum number of concurrent invocations. It may
   * be a function, so that a limit the user can change is read again for
   * every run.
   * @param onCompleted called when a run produced a result.
   * @param onFailed called when a run threw or rejected.
   */
  constructor(run, maxParallel, onCompleted, onFailed) {
    this.run = run;
    this.maxParallel = maxParallel;
    this.onCompleted = onCompleted;
    this.onFailed = onFailed;
  }
  run;
  maxParallel;
  onCompleted;
  onFailed;
  queue = [];
  inFlight = 0;
  /**
   * The number of invocations that may be in flight at the same time.
   */
  get limit() {
    const value = typeof this.maxParallel === "function" ? this.maxParallel() : this.maxParallel;
    return typeof value === "number" && value >= 1 ? Math.floor(value) : 1;
  }
  /**
   * Queues a test invocation and starts it if the parallelism budget allows.
   */
  enqueue(config) {
    this.queue.push(config);
    this.drain();
  }
  /**
   * The number of invocations waiting to start.
   */
  get pending() {
    return this.queue.length;
  }
  /**
   * The number of invocations currently running.
   */
  get running() {
    return this.inFlight;
  }
  /**
   * Drops the invocations that have not started yet.
   *
   * The invocations that are already running are not stopped here: the
   * caller kills them, and each of them reports its own outcome.
   */
  cancel() {
    this.queue.length = 0;
  }
  drain() {
    while (this.inFlight < this.limit && this.queue.length > 0) {
      const config = this.queue.shift();
      this.start(config);
    }
  }
  start(config) {
    this.inFlight++;
    try {
      const promise = this.run(config);
      promise.then(
        (result) => this.finish(config, result, void 0),
        (error) => this.finish(config, void 0, toError(error))
      );
    } catch (e) {
      this.finish(config, void 0, toError(e));
    }
  }
  finish(config, result, error) {
    this.inFlight--;
    try {
      if (error) {
        this.onFailed(config, error);
      } else {
        this.onCompleted(config, result);
      }
    } finally {
      this.drain();
    }
  }
};
function toError(e) {
  return e instanceof Error ? e : new Error(String(e));
}

// src/lib/goModule.ts
var fs7 = require("fs");
var path7 = require("path");
function findGoModule(dir) {
  let current = path7.resolve(dir);
  for (; ; ) {
    const modFile = path7.join(current, "go.mod");
    if (fs7.existsSync(modFile)) {
      const modulePath = readModulePath(modFile);
      return modulePath ? { root: current, path: modulePath } : void 0;
    }
    const parent = path7.dirname(current);
    if (parent === current) {
      return void 0;
    }
    current = parent;
  }
}
function readModulePath(modFile) {
  let content;
  try {
    content = fs7.readFileSync(modFile, "utf8");
  } catch (e) {
    return void 0;
  }
  for (const line of content.split("\n")) {
    const match = /^\s*module\s+("[^"]+"|\S+)/.exec(line);
    if (match) {
      return match[1].replace(/^"|"$/g, "");
    }
  }
  return void 0;
}
function importPathOf(module2, dir) {
  const relative3 = path7.relative(module2.root, dir).split(path7.sep).join("/");
  return relative3 === "" ? module2.path : module2.path + "/" + relative3;
}

// src/goTestExplorer.ts
var GoTestExplorer = class {
  goTestProvider;
  commands;
  testQueue;
  constructor(context) {
    this.commands = new Commands();
    this.goTestProvider = new GoTestProvider(context, this.commands);
    const testDiscoverer = new TestDiscovery(this.commands, context);
    this.testQueue = new TestQueue(
      (testConfig) => runGoTest(testConfig),
      // The limit is read for every run, so a change to the setting
      // takes effect without reloading the window.
      () => maxParallelTests(),
      (testConfig, result) => this.onRunCompleted(testConfig, result),
      (testConfig, error) => this.onRunFailed(testConfig, error)
    );
    vscode7.window.registerTreeDataProvider("goTestExplorer", this.goTestProvider);
    context.subscriptions.push(
      vscode7.commands.registerCommand("goTestExplorer.runTest", this.onRunSingleTest.bind(this))
    );
    context.subscriptions.push(
      vscode7.commands.registerCommand("goTestExplorer.runAllTest", this.onRunAllTests.bind(this))
    );
    context.subscriptions.push(
      vscode7.commands.registerCommand("goTestExplorer.refreshTestExplorer", () => {
        testDiscoverer.discoverAllTests();
      })
    );
    const cancelTestRun = () => {
      this.testQueue.cancel();
      const stopped = cancelRunningTests();
      if (stopped === 0) {
        vscode7.window.showInformationMessage("No test run is in progress.");
      }
    };
    context.subscriptions.push(
      vscode7.commands.registerCommand("goTestExplorer.cancelTestRun", cancelTestRun)
    );
    testOutput.setCancelHandler(cancelTestRun);
    context.subscriptions.push(
      vscode7.commands.registerCommand("goTestExplorer.showTestoutput", (testNode) => {
        const output = testNode.testResult && testNode.testResult.output && testNode.testResult.output.length > 0 ? testNode.testResult.output.join("\n") : "No output";
        vscode7.window.showInformationMessage(output);
      })
    );
    context.subscriptions.push(
      vscode7.commands.registerCommand("goTestExplorer.goToLocation", this.go.bind(this))
    );
    context.subscriptions.push(
      vscode7.commands.registerCommand("goTestExplorer.runTestSuite", this.runTestSuite.bind(this))
    );
    testDiscoverer.discoverAllTests();
  }
  async onRunSingleTest(testNode) {
    this.commands.sendTestRunStarted([testNode]);
    const testConfig = this.buildTestConfig(testNode);
    this.enqueueTest(testConfig);
  }
  runTestSuite(testNode) {
    if (testNode.children.length === 0) {
      return;
    }
    this.commands.sendTestRunStarted([...testNode.children, testNode]);
    const testConfig = this.buildTestConfig(testNode);
    this.enqueueTest(testConfig);
  }
  /**
   * Runs every test of the workspace.
   *
   * The files are grouped by the module they belong to, and one run tests
   * all the packages of a module at once: the packages are compiled once,
   * and the tool decides how to spread them over the available cores.
   */
  onRunAllTests() {
    const suites = this.goTestProvider.discoveredTests.filter((s) => s.isTestSuite);
    const groups = /* @__PURE__ */ new Map();
    const withoutModule = [];
    const byDirectory = /* @__PURE__ */ new Map();
    suites.forEach((suite) => {
      const dir = path8.dirname(suite.uri.fsPath);
      const files = byDirectory.get(dir) || [];
      files.push(suite);
      byDirectory.set(dir, files);
    });
    byDirectory.forEach((files, dir) => {
      const module2 = findGoModule(dir);
      if (!module2) {
        withoutModule.push(...files);
        return;
      }
      let group = groups.get(module2.root);
      if (!group) {
        group = { module: module2, packages: [], suites: [] };
        groups.set(module2.root, group);
      }
      group.packages.push({
        importPath: importPathOf(module2, dir),
        path: path8.relative(module2.root, dir).split(path8.sep).join("/"),
        files: files.map((file) => ({
          uri: file.uri,
          name: file.name,
          functions: file.children.map((child) => child.name)
        }))
      });
      group.suites.push(...files);
    });
    withoutModule.forEach((suite) => this.runTestSuite(suite));
    groups.forEach((group) => this.runModule(group));
  }
  /**
   * Runs every test of a module in one process.
   */
  runModule(group) {
    const nodes = [];
    group.suites.forEach((suite) => nodes.push(...suite.children, suite));
    this.commands.sendTestRunStarted(nodes);
    const testConfig = {
      dir: group.module.root,
      settings: runSettings(group.suites[0].uri),
      flags: [],
      functions: group.suites.reduce(
        (all, suite) => all.concat(suite.children.map((child) => child.name)),
        []
      ),
      testUri: group.suites[0].uri,
      testName: group.suites[0].name,
      packages: group.packages
    };
    this.enqueueTest(testConfig);
  }
  buildTestConfig(testNode) {
    let tests = testNode.children.map((node) => node.name);
    tests = tests.length > 0 ? tests : [testNode.name];
    const testConfig = {
      dir: path8.dirname(testNode.uri.fsPath),
      settings: runSettings(testNode.uri),
      flags: [],
      functions: tests,
      testUri: testNode.uri,
      testName: path8.basename(testNode.uri.fsPath)
    };
    return testConfig;
  }
  enqueueTest(testConfig) {
    this.testQueue.enqueue(testConfig);
  }
  /**
   * A test invocation finished. Attribute the outcome to each test that was
   * requested and report the suite-level result.
   */
  onRunCompleted(testConfig, result) {
    if (testConfig.packages && testConfig.packages.length > 0) {
      this.onModuleRunCompleted(testConfig, result);
      return;
    }
    let isTestSuitePassed = true;
    testConfig.functions.forEach((t) => {
      let isTestPassed = true;
      if (result.isPassed === false && (!result.failedTests || result.failedTests.length === 0 || hasFailed(result.failedTests, t))) {
        isTestPassed = false;
        isTestSuitePassed = false;
      }
      this.commands.sendTestResult(
        new TestResult(testConfig.testUri, t, isTestPassed, result.output, result.err)
      );
    });
    this.commands.sendTestResult(
      new TestResult(
        testConfig.testUri,
        testConfig.testName,
        isTestSuitePassed,
        result.output,
        result.err
      )
    );
    this.commands.sendTestCompleted([testConfig.testUri]);
  }
  /**
   * A run that tested several packages has finished.
   *
   * The outcome of a test is read from the package it belongs to, so that a
   * failure in one package does not mark the tests of another one as failed.
   */
  onModuleRunCompleted(testConfig, result) {
    const uris = [];
    testConfig.packages.forEach((pkg) => {
      const packageResult = result.packages.get(pkg.importPath);
      const failed = packageResult ? packageResult.failed : !result.isPassed;
      const failedTests = packageResult ? packageResult.failedTests : result.failedTests;
      const output = packageResult ? this.outputOfPackage(packageResult, result) : result.output;
      pkg.files.forEach((file) => {
        uris.push(file.uri);
        let isFilePassed = true;
        file.functions.forEach((t) => {
          let isTestPassed = true;
          if (failed && (failedTests.length === 0 || hasFailed(failedTests, t))) {
            isTestPassed = false;
            isFilePassed = false;
          }
          this.commands.sendTestResult(
            new TestResult(file.uri, t, isTestPassed, output, result.err)
          );
        });
        this.commands.sendTestResult(
          new TestResult(file.uri, file.name, isFilePassed, output, result.err)
        );
      });
    });
    this.commands.sendTestCompleted(uris);
  }
  /**
   * The output of a package.
   *
   * A package that did not build has no output of its own, so the output of
   * the run is used, which holds the build error.
   */
  outputOfPackage(packageResult, result) {
    return packageResult.buildFailed ? result.output : packageResult.output.slice();
  }
  /**
   * A test invocation failed outright. Report the whole suite as failed
   * rather than leaving it spinning forever.
   */
  onRunFailed(testConfig, error) {
    const output = [error.message];
    if (testConfig.packages && testConfig.packages.length > 0) {
      const uris = [];
      testConfig.packages.forEach((pkg) => {
        pkg.files.forEach((file) => {
          uris.push(file.uri);
          file.functions.forEach((t) => {
            this.commands.sendTestResult(new TestResult(file.uri, t, false, output, error));
          });
          this.commands.sendTestResult(new TestResult(file.uri, file.name, false, output, error));
        });
      });
      this.commands.sendTestCompleted(uris);
      return;
    }
    testConfig.functions.forEach((t) => {
      this.commands.sendTestResult(new TestResult(testConfig.testUri, t, false, output, error));
    });
    this.commands.sendTestResult(
      new TestResult(testConfig.testUri, testConfig.testName, false, output, error)
    );
    this.commands.sendTestCompleted([testConfig.testUri]);
  }
  /**
   * Opens the file that declares a test and selects its name.
   *
   * The open document is read rather than the file on disk, so a test that
   * has been edited but not saved is still found where the user expects it.
   */
  async go(testNode) {
    try {
      const document = await vscode7.workspace.openTextDocument(testNode.uri);
      const scan = scanGoSource(document.getText());
      const declaration = scan.declarations.find((d) => d.name === testNode.name);
      if (!declaration) {
        throw new Error("Could not find test (no symbols matching)");
      }
      await vscode7.window.showTextDocument(document);
      const selection = new vscode7.Selection(
        new vscode7.Position(declaration.line, declaration.startChar),
        new vscode7.Position(declaration.line, declaration.endChar)
      );
      vscode7.window.activeTextEditor.selection = selection;
      vscode7.window.activeTextEditor.revealRange(selection, vscode7.TextEditorRevealType.InCenter);
    } catch (r) {
      vscode7.window.showWarningMessage(r instanceof Error ? r.message : String(r));
    }
  }
};

// src/extension.ts
function activate(context) {
  if (!isToolAvailable("go")) {
    vscode8.window.showErrorMessage(
      'Cannot find the "go" binary. Go Test Explorer needs it to run tests. Install Go and make sure it is on your PATH, then reload the window.'
    );
  }
  new GoTestExplorer(context);
}
function deactivate() {
  cancelRunningTests();
  testOutput.dispose();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
