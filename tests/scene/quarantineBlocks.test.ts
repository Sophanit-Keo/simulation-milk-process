// The quarantine's batch blocks (src/scene/equipment/packs/quarantineBlocks.ts): one block a batch with one
// lamp in the batch's status colour, a click on it picks the batch, and since phase 5 a batch under
// investigation blinks its lamp until it is judged.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BatchSnapshot, BatchStatus } from '../../src/contracts';
import { blockPlaceOf, createQuarantineBlocks, INVESTIGATION_BLINK_S, PALLETS_PER_BLOCK } from '../../src/scene/equipment/packs/quarantineBlocks';

const batch = (id: number, status: BatchStatus, pallets = 58, flags: BatchSnapshot['flags'] = []): BatchSnapshot => ({
  id,
  filler: 'A',
  status,
  startS: 0,
  endS: 28_800,
  releaseAtS: 633_600,
  bestBeforeS: 15_724_800,
  pallets,
  packs: pallets * 1_008,
  lastPalletPacks: 1_008,
  samples: 16,
  qaResult: 'pending',
  flags,
  creamingRiskPct: 0,
});

const make = () => createQuarantineBlocks(new THREE.BoxGeometry(), new THREE.SphereGeometry(), new THREE.MeshStandardMaterial());
const lampHex = (blocks: ReturnType<typeof make>, id: number): string => {
  const color = new THREE.Color();
  blocks.lamps.getColorAt(blockPlaceOf(id), color);
  return color.getHexString();
};

describe('quarantine blocks', () => {
  it('stand one block a batch, lit by its status, and a click on its pallets or its lamp picks it', () => {
    const blocks = make();
    blocks.update([batch(12, 'hold'), batch(13, 'blocked'), batch(54, 'filling', 20)]);
    expect(blocks.state()).toMatchObject({ blocks: 3, pallets: 58 + 58 + 20, blocked: 1, investigated: 0 });
    expect(lampHex(blocks, 12)).toBe('a87400');
    expect(lampHex(blocks, 13)).toBe('c63a2b');
    expect(lampHex(blocks, 54)).toBe('1f8f57');
    expect(blocks.batchAt(blocks.pallets, blockPlaceOf(13) * PALLETS_PER_BLOCK + 5)).toBe(13);
    expect(blocks.batchAt(blocks.lamps, blockPlaceOf(12))).toBe(12);
  });

  it('blinks the lamp of a batch under investigation on real time, lit then pale, until it is blocked', () => {
    const blocks = make();
    const held = [batch(12, 'hold'), batch(54, 'filling', 20, ['sterileAir'])];
    blocks.update(held, 0);
    expect(blocks.state().investigated).toBe(1);
    const lit = lampHex(blocks, 54);
    blocks.update(held, INVESTIGATION_BLINK_S / 2);
    const pale = lampHex(blocks, 54);
    expect(pale).not.toBe(lit);
    blocks.update(held, INVESTIGATION_BLINK_S / 2);
    expect(lampHex(blocks, 54)).toBe(lit);
    // The batch next to it does not blink.
    expect(lampHex(blocks, 12)).toBe('a87400');
    // Judged and blocked, it is plain red.
    blocks.update([batch(12, 'hold'), batch(54, 'blocked', 58, ['sterileAir'])], INVESTIGATION_BLINK_S / 2);
    expect(blocks.state().investigated).toBe(0);
    expect(lampHex(blocks, 54)).toBe('c63a2b');
  });
});
