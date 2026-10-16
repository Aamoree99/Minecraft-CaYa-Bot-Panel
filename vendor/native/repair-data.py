#!/usr/bin/env python3
"""Repair missing26.1 loot/tool metadata from the pinned official26.1 dataset.
IDs are translated by names; no26.3 IDs or guessed loot are copied across versions.
"""
import json,sys
from pathlib import Path
base,official=map(Path,sys.argv[1:]);relative=Path('minecraft-data/data/pc/26.1')
blocks=json.loads((base/relative/'blocks.json').read_text());reference=json.loads((official/relative/'blocks.json').read_text())
old_items={i['id']:i['name'] for i in json.loads((official/relative/'items.json').read_text())}
new_items={i['name']:i['id'] for i in json.loads((base/relative/'items.json').read_text())}
by_name={b['name']:b for b in reference};repaired=0
for block in blocks:
 source=by_name.get(block['name'])
 if not source:raise RuntimeError('Missing authoritative26.1 block: '+block['name'])
 if not block.get('drops') and source.get('drops'):
  block['drops']=[new_items[old_items[item]] for item in source['drops']];repaired+=1
 if not block.get('harvestTools') and source.get('harvestTools'):
  block['harvestTools']={str(new_items[old_items[int(item)]]):value for item,value in source['harvestTools'].items()}
(base/relative/'blocks.json').write_text(json.dumps(blocks,indent=2)+'\n')
# Verify existing26.3 references; deliberately do not fill naturally empty drops.
relative=Path('minecraft-data/data/pc/26.3');items={i['id'] for i in json.loads((base/relative/'items.json').read_text())}
for block in json.loads((base/relative/'blocks.json').read_text()):
 for item in block.get('drops',[]):
  if item not in items:raise RuntimeError('Unknown26.3 drop ID: '+str(item))
print('Restored authoritative26.1 drops for',repaired,'blocks;26.3 references valid')
