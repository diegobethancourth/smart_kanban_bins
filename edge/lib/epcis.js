/**
 * GS1 EPCIS 2.0 ObjectEvent for a reorder event (T3.7, optional).
 *
 * One reorder event becomes one EPCISDocument with a single ObjectEvent:
 *   action OBSERVE, bizStep cycle_counting (the bin counted its stock),
 *   the item as a quantity (class-level, no serial numbers), and the bin as
 *   the read point. ROP and safety stock go in project-specific fields
 *   (prefix skb:), which EPCIS allows as user extensions.
 *
 * The identifiers are URNs because the CSS item codes and bins have no GS1
 * keys (GTIN/GLN); EPCIS 2.0 accepts any URI there.
 *
 * Validated against the official schema with: python tools/validate_epcis.py
 */
'use strict';

const CONTEXT = [
  'https://ref.gs1.org/standards/epcis/epcis-context.jsonld',
  { skb: 'https://github.com/diegobethancourth/smart_kanban_bins/ns#' },
];

/** Build an EPCISDocument from a reorder event payload (see lib/p240.js). */
function fromReorder(ev, ue) {
  const ueId = String(ue || 'UE-A').toLowerCase();
  return {
    '@context': CONTEXT,
    type: 'EPCISDocument',
    schemaVersion: '2.0',
    creationDate: ev.ts,
    epcisBody: {
      eventList: [
        {
          type: 'ObjectEvent',
          eventTime: ev.ts,
          eventTimeZoneOffset: '+00:00',
          action: 'OBSERVE',
          bizStep: 'cycle_counting',
          readPoint: { id: `urn:smartkanban:${ueId}:${ev.bin_id}` },
          quantityList: [
            { epcClass: `urn:smartkanban:item:${ev.item}`, quantity: ev.units, uom: 'H87' },
          ],
          'skb:reorderPoint': ev.rop,
          'skb:safetyStock': ev.ss,
        },
      ],
    },
  };
}

module.exports = { fromReorder, CONTEXT };
