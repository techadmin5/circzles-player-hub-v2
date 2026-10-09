# Source reconciliation

All 82 manufacturing rows are preserved. Each row requires an explicit canonical decision; the checked-in manifest applies nothing by default. Source names are review hints only. Piece counts are absent for every supplied row and must be confirmed before treating apparently identical gameplay configurations as the same product.

| Name hint | Source rows | Sizes | Levels | Decision needed |
| --- | --- | --- | --- | --- |
| Metamorphosis / Metamorphosis / metamorphosis | 07-R1, 22-R2, 48-R3 | 10, 10, 10 | 13, 02, 02 | Different levels require separate playable variants. |
| Spiritual Awakening / Spiritual Awakening | 10-R1, 51-R3 | 10, 10 | 13, 13 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Gold Fishing / Gold Fishing | 12-R1, 59-R3 | 12, 12 | 15, 15 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| L.S.Tree / L.S.Tree | 13-R1, 27-R2 | 12, 12 | 15, 08 | Different levels require separate playable variants. |
| Pluto / Pluto | 14-R1, 65-R3 | 12, 12 | 18, 18 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Cosmic Walk / Cosmic walk | 20-R2, 42-R3 | 10, 10 | 16, 16 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Elephant / Elephant | 21-R2, 44-R3 | 10, 10 | 19, 19 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Midnight Bazaar / Midnight Bazaar | 23-R2, 49-R3 | 10, 10 | 05, 05 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Folklore / Folklore | 26-R2, 57-R3 | 12, 12 | 21, 21 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Lightone / Lightone | 28-R2, 60-R3 | 12, 12 | 23, 23 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Lion / LION | 29-R2, 61-R3 | 12, 12 | 01, 01 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Mind Map / Mind Map | 30-R2, 63-R3 | 12, 12 | 04, 04 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Aapdo Dham / Aapdo Dham | 31-R2, 71-R3 | 16, 16 | 14, 14 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Birdwired / Birdwired | 32-R2, 73-R3 | 16, 16 | 07, 07 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| DNA-Coded Carbon / DNA-Coded Carbon | 33-R2, 74-R3 | 16, 16 | 25, 25 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Forgotten worlds / Forgotten Worlds | 34-R2, 75-R3 | 16, 16 | 22, 22 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Once Upon India / Once Upon India | 35-R2, 76-R3 | 16, 16 | 20, 20 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Rickshaw / Rickshaw | 36-R2, 77-R3 | 16, 16 | 24, 24 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Serenity / Serenity | 37-R2, 78-R3 | 16, 16 | 17, 17 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |
| Waiting For God / Waiting for god | 38-R2, 82-R3 | 16, 16 | 11, 11 | Explicit shared or separate canonical mapping; confirm pieces and gameplay. |

Spelling ambiguity also needs explicit review: Colorstrom (03-R1) / Colorstom (40-R3), and Peacock (24-R2) / Peocock (50-R3). The source values have not been corrected. R3 names, identifiers, quantities and SKUs now follow the finalized pre-launch table exactly. Superseded R3 prefixes are not aliases or historical production identities and are not retained. R1 and R2 are unchanged.

Lion 29-R2 / 61-R3 is the supplied example of two batches that may share one canonical variant: 48 units and 500 units, each beginning at serial 1. The prefixes are `CC-29-R2-01` and `CC-61-R3-01`; `mapping.example.json` shows an explicit shared key. Do not use that fragment as the complete production manifest.

Metamorphosis R1 level 13 differs from R2/R3 level 02; L.S.Tree R1 level 15 differs from R2 level 08. A shared key for conflicting levels is rejected, even when names match exactly. Names differing only in case never trigger a merge.

The complete source totals **82 rows and 12,001 units**: R1 has 15 rows / 7,125 units; R2 has 23 rows / 676 units; R3 has 44 rows / 4,200 units.

| Source record | Size | Brand | Number / Run | Level | Units | Exact source SKU | Import behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Puzzle Saver Board | NA | Cogzart | 15 / R1 | NA | 500 | `CZ-15-R1-NA-0001` | ACCESSORY; catalog/manufacturing only |
| Cupcake | 06 | CircZles | 16 / R2 | NA | 64 | `CC-16-R2-NA-0001` | CIRCZLES; incomplete DRAFT |
| Introduction To Circzles | 06 | CircZles | 17 / R2 | NA | 32 | `CC-17-R2-NA-0001` | CIRCZLES; incomplete DRAFT |
| Sorcery | 06 | CircZles | 18 / R2 | NA | 32 | `CC-18-R2-NA-0001` | CIRCZLES; incomplete DRAFT |

All four retain the original source values and require explicit mappings. None creates a playable puzzle, claim prefix, ownership, submission, leaderboard or reward path. The three CircZles remain DRAFT until their gameplay configuration is explicitly completed and activated; the positive playable level rule remains unchanged. Puzzle Saver Board cannot be claimed through Add CircZles. No missing level is inferred from the name or SKU.
