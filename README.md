# OpenSOSData MCP Server

Real-time US business entity search for Claude. Search, verify,
and check the status of any LLC, corporation, or registered entity
across all 53 US jurisdictions directly from your Claude conversation.

**The only business entity search MCP with complete US coverage:**
all 50 states + Washington DC + Puerto Rico + US Virgin Islands.

---

## What You Can Do

Ask Claude things like:

- "Is Stripe Inc registered as a corporation in Delaware?"
- "Search for any LLC named Apex Consulting in Texas, Florida, and New York"
- "Verify these 5 vendors are properly registered" (batch check)
- "What states does OpenSOSData cover?"
- "Check if this company is active or dissolved in California"

---

## Connect via Claude.ai

1. Go to [claude.ai/connectors](https://claude.ai/connectors)
2. Find OpenSOSData
3. Connect with your API key from [opensosdata.com](https://opensosdata.com)

---

## Install via Claude Desktop or Claude Code

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opensosdata": {
      "command": "npx",
      "args": ["-y", "@opensosdata/mcp-server"],
      "env": {
        "OPENSOSDATA_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Get your API key at [opensosdata.com](https://opensosdata.com).
10 free lookups included on signup. No credit card required.

---

## Remote MCP Server (No Installation)

Connect directly without installing anything:

```
https://mcp.opensosdata.com/mcp
```

Pass your OpenSOSData API key as a Bearer token in the
Authorization header.

---

## Available Tools

| Tool | Description |
|------|-------------|
| `search_business_entity` | Search by entity name and state. Returns name, ID, status, type, registered agent, address. |
| `check_entity_status` | Verify if a business is active, inactive, or dissolved. Optimized for KYB and due diligence. |
| `batch_search` | Search up to 10 entities simultaneously across different states. |
| `list_supported_jurisdictions` | Returns all 53 active jurisdictions with live coverage. |
| `get_jurisdictions_for_region` | Get jurisdictions by US region (northeast, southeast, midwest, southwest, west, territories). |

All tools are read-only (`readOnlyHint: true`). No data is modified.

---

## Usage Examples

### Example 1: KYB Verification

**You:** "Is Stripe Inc registered as a corporation in Delaware?"

**Claude:** Calls `check_entity_status` with entity_name="Stripe" and
state="DE", returns confirmation that Stripe is active and registered,
with entity ID and filing details.

---

### Example 2: Multi-State Due Diligence

**You:** "Search for any LLC named Apex Consulting in Texas,
Florida, and New York"

**Claude:** Calls `batch_search` with three entries, returns all
matching entities across all three states with their current status.

---

### Example 3: Vendor Verification

**You:** "Verify these vendors are properly registered:
- Acme Corp in California
- Summit LLC in Georgia
- Pinnacle Inc in Illinois"

**Claude:** Calls `batch_search`, returns active/inactive status
for each vendor with entity IDs for your records.

---

### Example 4: Regional Compliance Check

**You:** "What jurisdictions should I check for a company doing
business across the Southeast?"

**Claude:** Calls `get_jurisdictions_for_region` with region="southeast",
returns all Southeast states so you know exactly which registries to verify.

---

### Example 5: Territory Coverage

**You:** "Does this API cover Puerto Rico and DC?"

**Claude:** Calls `list_supported_jurisdictions`, confirms coverage
of all 53 jurisdictions including DC, Puerto Rico, and US Virgin Islands.

---

## Coverage

53 US jurisdictions with live, real-time data:

- **All 50 US states** including Kansas (AWS WAF bypass via CapSolver)
- **Washington DC** (corponline.dlcp.dc.gov)
- **Puerto Rico** (rcp.estado.pr.gov)
- **US Virgin Islands** (corporationsandtrademarks.vi.gov)

Data is fetched live from official Secretary of State portals
at query time. Not a stale database.

---

## Pricing

| Tier | Cost |
|------|------|
| Free | 10 lookups on signup |
| Pay-as-you-go | $0.0314 per lookup |
| 100 lookups | $3.14 |

No subscription. No monthly fee. Pay only for what you use.

[Create your account](https://opensosdata.com) to get started.

---

## Who Uses This

- **KYB/Compliance teams** verifying business registrations
- **Due diligence workflows** checking entity status before deals
- **Legal professionals** confirming entity standing
- **Fintech and lending platforms** validating business customers
- **Developers** building business verification into their products

---

## Documentation

Full documentation and API reference: [opensosdata.com/mcp](https://opensosdata.com/mcp)

---

## Support

- **Email:** support@opensosdata.com
- **Docs:** [opensosdata.com/mcp](https://opensosdata.com/mcp)
- **Issues:** [github.com/OpenSOSData/opensosdata-mcp/issues](https://github.com/OpenSOSData/opensosdata-mcp/issues)

---

## Privacy

Your search queries are used only to fulfill your request.
No conversation data is stored beyond what is necessary to
return results.

Full privacy policy: [opensosdata.com/privacy](https://opensosdata.com/privacy)

---

## License

MIT

---

*OpenSOSData is not affiliated with any US government agency.
Data is sourced from official public Secretary of State portals.*
