const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TYPE_MAP = {
  String: "string",
  Number: "number",
  Integer: "integer",
  Boolean: "boolean",
  Date: "string",
  DateTime: "string",
  Any: undefined,
};

function usage() {
  console.error(
    [
      "Usage:",
      "  node convert-actions-to-tools.js <legacy-actions-folder> <new-tools-folder> [--clean]",
      "",
      "Example:",
      "  node convert-actions-to-tools.js \"C:\\Users\\gughini\\CopilotStudio\\SST\\actions\" \"C:\\Users\\gughini\\CopilotStudio\\dragent\\Giorgio2Clone\\capabilities\\tools\" --clean",
    ].join("\n"),
  );
}

function countIndent(line) {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function stripInlineComment(value) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle && previous !== "\\") inDouble = !inDouble;
    if (char === "#" && !inSingle && !inDouble && /\s/.test(previous || "")) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function parseScalar(rawValue) {
  const value = stripInlineComment(rawValue.trim());
  if (value === "") return "";
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  return value;
}

function splitKeyValue(content) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const previous = content[index - 1];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle && previous !== "\\") inDouble = !inDouble;
    if (char === ":" && !inSingle && !inDouble) {
      return [content.slice(0, index).trim(), content.slice(index + 1)];
    }
  }
  return [content.trim(), undefined];
}

function parseKey(rawKey) {
  return String(parseScalar(rawKey));
}

function prepareLines(text) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((raw) => ({ raw, indent: countIndent(raw), text: raw.trim() }))
    .filter((line) => line.text !== "" && !line.text.startsWith("#"));
}

function parseYaml(text) {
  const lines = prepareLines(text);
  const [value] = parseBlock(lines, 0, 0);
  return value || {};
}

function parseBlock(lines, index, indent) {
  const line = lines[index];
  if (!line || line.indent < indent) return [undefined, index];
  return line.text.startsWith("- ") && line.indent === indent
    ? parseArray(lines, index, indent)
    : parseMap(lines, index, indent);
}

function parseArray(lines, index, indent) {
  const result = [];
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith("- ")) break;

    const itemText = line.text.slice(2).trim();
    cursor += 1;

    if (itemText === "") {
      const [child, next] = parseBlock(lines, cursor, indent + 2);
      result.push(child);
      cursor = next;
      continue;
    }

    const [key, rawValue] = splitKeyValue(itemText);
    if (rawValue !== undefined) {
      const item = {};
      item[parseKey(key)] =
        rawValue.trim() === ""
          ? parseBlock(lines, cursor, indent + 2)[0]
          : parseScalar(rawValue);

      if (rawValue.trim() === "") {
        cursor = parseBlock(lines, cursor, indent + 2)[1];
      }

      const [extra, next] = parseMap(lines, cursor, indent + 2);
      Object.assign(item, extra || {});
      result.push(item);
      cursor = next;
    } else {
      result.push(parseScalar(itemText));
    }
  }

  return [result, cursor];
}

function parseMap(lines, index, indent) {
  const result = {};
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent !== indent || line.text.startsWith("- ")) break;

    const [rawKey, rawValue] = splitKeyValue(line.text);
    if (rawValue === undefined) break;

    cursor += 1;
    const key = parseKey(rawKey);
    if (rawValue.trim() === "") {
      const [child, next] = parseBlock(lines, cursor, indent + 2);
      result[key] = child;
      cursor = next;
    } else {
      result[key] = parseScalar(rawValue);
    }
  }

  return [result, cursor];
}

function quoteYaml(value) {
  if (typeof value !== "string") return String(value);
  if (/^[A-Za-z0-9 _./:@-]+$/.test(value) && !/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function schemaForLegacyType(type) {
  if (!type) return undefined;
  if (typeof type === "string") {
    const jsonType = TYPE_MAP[type] || type.toLowerCase();
    if (!jsonType) return undefined;
    if (type === "Date") return { type: jsonType, format: "date" };
    if (type === "DateTime") return { type: jsonType, format: "date-time" };
    return { type: jsonType };
  }

  if (type.kind === "Record") return { type: "object" };
  if (type.kind === "Table") return { type: "array" };
  return undefined;
}

function splitPropertyPath(propertyName) {
  const segments = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < propertyName.length; index += 1) {
    const char = propertyName[index];
    const previous = propertyName[index - 1];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle && previous !== "\\") {
      inDouble = !inDouble;
      continue;
    }
    if (char === "." && !inSingle && !inDouble) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current) segments.push(current);
  return segments;
}

function findInputSchema(root, propertyName) {
  if (!root || !root.properties || !propertyName) return undefined;

  let node = root;
  for (const segment of splitPropertyPath(propertyName)) {
    const properties = node.properties || node.type?.properties;
    if (!properties || !properties[segment]) return undefined;
    node = properties[segment];
  }
  return node;
}

function inferInputSchema(action, input) {
  const schemaNode = findInputSchema(action.dynamicInputSchema, input.propertyName);
  return schemaForLegacyType(schemaNode?.type);
}

function inferConnectorId(connectionReference) {
  const match = String(connectionReference || "").match(/(?:^|\.)(shared_[A-Za-z0-9_]+)(?:\.|$)/);
  return match ? `/providers/Microsoft.PowerApps/apis/${match[1]}` : undefined;
}

function randomSuffix() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let index = 0; index < 3; index += 1) {
    suffix += chars[crypto.randomInt(chars.length)];
  }
  return suffix;
}

function outputFileName(inputFileName, existingNames) {
  const specialExtension = inputFileName.endsWith(".mcs.yml")
    ? ".mcs.yml"
    : inputFileName.endsWith(".mcs.yaml")
      ? ".mcs.yaml"
      : path.extname(inputFileName);
  const baseName = inputFileName.slice(0, inputFileName.length - specialExtension.length);

  let candidate;
  do {
    candidate = `${baseName}_${randomSuffix()}${specialExtension}`;
  } while (existingNames.has(candidate));

  existingNames.add(candidate);
  return candidate;
}

function baseMetadata(document, fallbackName) {
  const metadata = document["mcs.metadata"] || {};
  return {
    componentName: metadata.componentName || document.modelDisplayName || fallbackName,
    description: metadata.description || document.modelDescription,
  };
}

function convertConnectorAction(document, action) {
  const connectionReference = action.connectionReference;
  const connectorId = inferConnectorId(connectionReference);
  if (!connectionReference || !connectorId || !action.operationId) {
    return { skipped: "Connector action is missing connectionReference, connectorId inference, or operationId" };
  }

  const metadata = baseMetadata(document, "Converted connector action");
  const authMode = action.connectionProperties?.mode || "Invoker";
  const inputs = Array.isArray(document.inputs) ? document.inputs : [];

  const lines = [];
  lines.push("mcs.metadata:");
  lines.push(`  componentName: ${quoteYaml(metadata.componentName)}`);
  if (metadata.description) lines.push(`  description: ${quoteYaml(metadata.description)}`);
  lines.push("kind: ConnectorTool");
  lines.push(`authMode: ${quoteYaml(authMode)}`);
  lines.push(`connectionReference: ${quoteYaml(connectionReference)}`);
  lines.push(`connectorId: ${quoteYaml(connectorId)}`);
  lines.push(`operationId: ${quoteYaml(action.operationId)}`);

  if (inputs.length > 0) {
    lines.push("toolInputs:");
    for (const input of inputs) {
      if (!input.propertyName) continue;

      lines.push(`  - name: ${quoteYaml(input.propertyName)}`);
      lines.push("    value:");
      lines.push("      kind: ValueReference");

      const schema = inferInputSchema(action, input);
      if (schema) lines.push(`      type: ${quoteYaml(JSON.stringify(schema))}`);
      if (Object.prototype.hasOwnProperty.call(input, "value")) {
        lines.push(`      defaultValue: ${quoteYaml(JSON.stringify(input.value))}`);
      }
      lines.push("");
    }
    if (lines[lines.length - 1] === "") lines.pop();
  }

  return { yaml: `${lines.join("\n")}\n` };
}

function convertMcpAction(document, action) {
  const connectionReference = action.connectionReference;
  const connectorId = inferConnectorId(connectionReference);
  const operationId = action.operationDetails?.operationId;
  if (!connectionReference || !connectorId || !operationId) {
    return { skipped: "MCP action is missing connectionReference, connectorId inference, or operationDetails.operationId" };
  }

  const metadata = baseMetadata(document, "Converted MCP server");
  const displayName = document.modelDisplayName || metadata.componentName;
  const componentName = `${displayName} — ${displayName}`;
  const authMode = action.connectionProperties?.mode || "Invoker";

  const lines = [];
  lines.push("mcs.metadata:");
  lines.push(`  componentName: ${quoteYaml(componentName)}`);
  if (metadata.description) lines.push(`  description: ${quoteYaml(metadata.description)}`);
  lines.push("kind: McpTool");
  lines.push(`authMode: ${quoteYaml(authMode)}`);
  lines.push(`connectionReference: ${quoteYaml(connectionReference)}`);
  lines.push(`connectorId: ${quoteYaml(connectorId)}`);
  lines.push(`operationId: ${quoteYaml(operationId)}`);

  return { yaml: `${lines.join("\n")}\n` };
}

function convertTaskDialog(document) {
  if (document.kind !== "TaskDialog") {
    return { skipped: `Unsupported top-level kind '${document.kind || "unknown"}'` };
  }

  const action = document.action || {};
  if (action.kind === "InvokeConnectorTaskAction") {
    return convertConnectorAction(document, action);
  }
  if (action.kind === "InvokeExternalAgentTaskAction") {
    return convertMcpAction(document, action);
  }
  if (action.kind === "InvokeFlowTaskAction") {
    return { skipped: "Flow actions are not supported" };
  }
  if (action.kind === "InvokeAIBuilderModelTaskAction") {
    return { skipped: "AI prompt actions are not supported" };
  }

  return { skipped: `Unsupported action kind '${action.kind || "unknown"}'` };
}

function cleanOutputFolder(outputFolder) {
  if (!fs.existsSync(outputFolder)) return 0;
  let deleted = 0;
  for (const fileName of fs.readdirSync(outputFolder)) {
    if (!/\.ya?ml$/i.test(fileName)) continue;
    fs.rmSync(path.join(outputFolder, fileName), { force: true });
    deleted += 1;
  }
  return deleted;
}

const args = process.argv.slice(2);
const clean = args.includes("--clean");
const folders = args.filter((arg) => arg !== "--clean");

if (folders.length !== 2) {
  usage();
  process.exit(1);
}

const [sourceFolder, outputFolder] = folders.map((folder) => path.resolve(folder));
if (!fs.existsSync(sourceFolder) || !fs.statSync(sourceFolder).isDirectory()) {
  console.error(`Source folder does not exist or is not a directory: ${sourceFolder}`);
  process.exit(1);
}

fs.mkdirSync(outputFolder, { recursive: true });
const deleted = clean ? cleanOutputFolder(outputFolder) : 0;
const existingNames = new Set(fs.readdirSync(outputFolder));
const sourceFiles = fs
  .readdirSync(sourceFolder)
  .filter((fileName) => /\.ya?ml$/i.test(fileName))
  .sort((left, right) => left.localeCompare(right));

let converted = 0;
let skipped = 0;

for (const fileName of sourceFiles) {
  const sourcePath = path.join(sourceFolder, fileName);
  const text = fs.readFileSync(sourcePath, "utf8");
  const document = parseYaml(text);
  const result = convertTaskDialog(document);

  if (result.skipped) {
    skipped += 1;
    console.warn(`Skipped ${fileName}: ${result.skipped}`);
    continue;
  }

  const targetFileName = outputFileName(fileName, existingNames);
  fs.writeFileSync(path.join(outputFolder, targetFileName), result.yaml, "utf8");
  converted += 1;
  console.log(`Converted ${fileName} -> ${targetFileName}`);
}

console.log(`Done. Converted ${converted}, skipped ${skipped}, deleted ${deleted}.`);
