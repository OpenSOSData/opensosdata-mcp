"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const tools_1 = require("./tools");
const server = new index_js_1.Server({ name: 'opensosdata', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
    tools: tools_1.toolDefinitions
}));
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        const result = await (0, tools_1.handleToolCall)(name, args);
        return {
            content: [{ type: 'text', text: result.text }],
            isError: result.isError
        };
    }
    catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
});
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch(console.error);
