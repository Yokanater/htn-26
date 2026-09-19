import type {
  CollaborationOutput,
  CompetitorDiscourseOutput,
  ResearchPlan,
  SwotActionsOutput,
} from "../contracts.js";
import type { ConsistencyOutput } from "../workflows/consistency.js";

/** Hand-written "model outputs" for the fixture evidence. The fake client returns these; they must pass validateReport. */

type Conf = "low" | "medium" | "high";
const obs = (claim: string, evidence_ids: string[], confidence: Conf) => ({
  claim, claim_type: "observed" as const, explanation: null, evidence_ids, confidence, insufficient_evidence: false,
});
const inf = (claim: string, explanation: string, evidence_ids: string[], confidence: Conf) => ({
  claim, claim_type: "inference" as const, explanation, evidence_ids, confidence, insufficient_evidence: false,
});

export const fakePlan: ResearchPlan = {
  queries: [
    { query: "best burr grinder for light roast pour-over", intent: "complement", source_type_hint: "forum", rationale: "Light-roast buyers need grinding hardware before brewing." },
    { query: "gooseneck kettle temperature control light roast", intent: "complement", source_type_hint: "editorial", rationale: "Brewing hardware used during the merchant's product." },
    { query: "coffee gift set mug biscotti", intent: "complement", source_type_hint: "editorial", rationale: "Gifting pairings used after purchase." },
    { query: "paper filters and water for light roast coffee", intent: "complement", source_type_hint: "any", rationale: "Consumables used while brewing." },
    { query: "specialty coffee subscription alternatives Canada", intent: "competitor", source_type_hint: "editorial", rationale: "Find direct and substitute subscription offers." },
    { query: "multi-roaster coffee subscription box review", intent: "competitor", source_type_hint: "review", rationale: "Substitute hypothesis: discovery boxes." },
    { query: "coffee capsule vs whole bean subscription", intent: "competitor", source_type_hint: "review", rationale: "Substitute hypothesis: convenience formats." },
    { query: "switched roasters because stale beans", intent: "discourse", source_type_hint: "forum", rationale: "Switching triggers tied to freshness." },
    { query: "coffee subscription complaints skipped shipment support", intent: "discourse", source_type_hint: "forum", rationale: "Complaints about fulfilment reliability." },
    { query: "light roast decaf subscription wish list", intent: "discourse", source_type_hint: "forum", rationale: "Unmet-need hypothesis around decaf." },
  ],
  stop_conditions: [
    "Stop a path after three consecutive results repeat already-collected evidence.",
    "Stop on any site that disallows collection.",
    "Require at least three source types before analysis.",
  ],
};

export const fakeCollaboration: CollaborationOutput = {
  candidates: [
    {
      id: "collab_1", rank: 1, brand_name: "Burrmark Grinders", entity_key: "burrmarkgrinders.example", use_moment: "before",
      ...obs("Burrmark sells burr grinders tuned for light-roast brewing, and a forum user says switching from a blade grinder to Burrmark fixed sour light-roast coffee.", ["ev_007", "ev_016", "ev_031"], "high"),
      is_direct_substitute: false, conflict_note: null,
      activation: { type: "bundle", description: "A 'first light-roast setup' bundle: one Burrmark hand grinder plus a 340 g Ethiopia Guji bag with a printed grind guide." },
      value_for_merchant: "Turns first-time light-roast buyers into successful brewers, which supports repeat subscription orders.",
      value_for_partner: "Reaches buyers who have just bought specialty beans and need a grinder.",
      risk_note: "Grinder price point may lift the bundle above the merchant's usual gift range; Burrmark stock depth is unknown.",
      first_validation_step: "Ask Burrmark for a 20-unit trial allocation and test the bundle on a waitlist page.",
    },
    {
      id: "collab_2", rank: 2, brand_name: "Kiln & Kettle", entity_key: "kilnandkettle.example", use_moment: "during",
      ...obs("Kiln & Kettle makes variable-temperature gooseneck kettles for pour-over, and a forum user credits one with fixing pour-over consistency for light roasts.", ["ev_008", "ev_017", "ev_031"], "high"),
      is_direct_substitute: false, conflict_note: null,
      activation: { type: "content", description: "A co-branded pour-over guide for the Ethiopia Guji using Kiln & Kettle's temperature presets." },
      value_for_merchant: "Gives subscribers a concrete brewing recipe, reducing 'too sour' experiences.",
      value_for_partner: "Positions its kettles inside a recipe for a specific, well-reviewed roast.",
      risk_note: "The guide only helps if subscribers own a variable-temperature kettle.",
      first_validation_step: "Publish the guide as a blog post and email it to 200 subscribers; count clicks to Kiln & Kettle.",
    },
    {
      id: "collab_3", rank: 3, brand_name: "Hale Stoneware", entity_key: "halestoneware.example", use_moment: "after",
      ...obs("Hale Stoneware sells mugs and drippers, runs collaboration drops with local food and drink makers, and appears in a gift guide alongside specialty beans.", ["ev_009", "ev_028", "ev_030"], "medium"),
      is_direct_substitute: false, conflict_note: null,
      activation: { type: "gift_with_purchase", description: "Include a Hale mug with three-month gift subscriptions during a limited gifting window." },
      value_for_merchant: "Raises the perceived value of gift subscriptions without discounting.",
      value_for_partner: "Puts its mugs in front of gift buyers and gets a collaboration-drop story.",
      risk_note: "Mug cost cuts gift-subscription margin; breakage in shipping.",
      first_validation_step: "Offer a pre-order of 30 gift sets and check the take rate against normal gift orders.",
    },
    {
      id: "collab_4", rank: 4, brand_name: "Crumb & Co", entity_key: "crumbandco.example", use_moment: "after",
      ...obs("Crumb & Co sells biscotti and shortbread gift boxes aimed at coffee lovers, and a gift guide recommends pairing them with specialty beans.", ["ev_010", "ev_030"], "medium"),
      is_direct_substitute: false, conflict_note: null,
      activation: { type: "event", description: "A virtual tasting night pairing two Alder & Ash roasts with Crumb & Co biscotti flavors." },
      value_for_merchant: "Creates a shareable event for subscribers and a gifting hook.",
      value_for_partner: "Introduces its gift boxes to an audience that already buys specialty coffee.",
      risk_note: "Both brands ship separately; cross-border shipping and food-labelling rules could complicate shared boxes.",
      first_validation_step: "Run one small tasting with 25 seats and ask attendees whether they would buy a joint box.",
    },
    {
      id: "collab_5", rank: 5, brand_name: "Clearbrew Filters", entity_key: "clearbrew.example", use_moment: "during",
      ...obs("A brewing guide names Clearbrew paper filters as part of preparing light roasts; no other source in the bundle mentions the brand.", ["ev_031"], "low"),
      is_direct_substitute: false, conflict_note: null,
      activation: { type: "channel", description: "Add a Clearbrew filter sample to subscription boxes for one month." },
      value_for_merchant: "Low-cost brewing extra that supports light-roast success.",
      value_for_partner: "Sampling to a target audience.",
      risk_note: "Only one source; the brand's Shopify presence and activity are unverified.",
      first_validation_step: "Confirm Clearbrew is an active Shopify brand and find a second independent mention before any outreach.",
    },
  ],
};

export const fakeCompetitors: CompetitorDiscourseOutput = {
  competitors: [
    {
      id: "comp_1", rank: 1, name: "Northline Roasters", entity_key: "northlineroasters.example", classification: "direct",
      classification_reason: "Sells 340 g single-origin bags at a similar price; test: compare origin overlap and price per 100 g.",
      ...obs("Northline sells 340 g single-origin bags from $18 with resealable bags, and a mix of forum, review and editorial sources describe it as consistent but recently pricier.", ["ev_004", "ev_014", "ev_018", "ev_025", "ev_029"], "high"),
    },
    {
      id: "comp_2", rank: 2, name: "Tidewater Coffee Co", entity_key: "tidewatercoffee.example", classification: "direct",
      classification_reason: "Subscription-led roaster in the same weight class; test: compare subscription discount and skip/pause options.",
      ...obs("Tidewater sells subscription medium and dark roasts with a 15% subscribe discount; one user reports stale bags and another reports no self-serve cancellation.", ["ev_005", "ev_013", "ev_024", "ev_029"], "medium"),
    },
    {
      id: "comp_3", rank: 3, name: "Brewbox", entity_key: "brewbox.example", classification: "substitute",
      classification_reason: "Solves 'discover great coffee' via three roasters per box instead of one; test: ask subscribers whether they would trade a Brewbox box for a single-roaster plan.",
      ...obs("Brewbox ships three roasters per monthly box; a reviewer likes discovery but reports uneven freshness and no way to keep a favorite.", ["ev_006", "ev_026", "ev_029"], "medium"),
    },
    {
      id: "comp_4", rank: 4, name: "Copperleaf Coffee", entity_key: "copperleafcoffee.example", classification: "direct",
      classification_reason: "Espresso blend overlaps the merchant's House Espresso; test: compare blend roast level and price.",
      ...obs("A forum user says Copperleaf's espresso blend tastes like a cafe shot but is a bit oily.", ["ev_019"], "low"),
    },
    {
      id: "comp_5", rank: 5, name: "Pod & Pour", entity_key: "podandpour.example", classification: "substitute",
      classification_reason: "Capsules meet the 'fast coffee at the office' job; test: check whether office buyers appear among the merchant's subscribers.",
      ...obs("One reviewer calls Pod & Pour capsules convenient for the office but finds the plastic pods wasteful.", ["ev_027"], "low"),
    },
    {
      id: "comp_6", rank: 6, name: "Cafe Fieldnote", entity_key: "cafefieldnote.example", classification: "adjacent",
      classification_reason: "Retail cafe stocking whole-bean bags from local roasters; test: track whether it stocks competing roasters at the same price.",
      ...obs("A local news item says Cafe Fieldnote opened with a wall of whole-bean bags from four local roasters, including Alder & Ash.", ["ev_032"], "low"),
    },
  ],
  themes: [
    {
      id: "theme_1", theme_kind: "praise", about: "Alder & Ash Coffee",
      ...obs("Reviewers say Alder & Ash light roasts taste good and arrive fresh.", ["ev_011", "ev_022"], "medium"),
      contradicting_evidence_ids: ["ev_021"],
      contradiction_note: "One forum user found the Kenya too sharp and sour.",
      sampling_bias_note: "Two self-selected commenters on different sites; enthusiasts are over-represented.",
    },
    {
      id: "theme_2", theme_kind: "complaint", about: "Alder & Ash Coffee",
      ...obs("Two commenters report fulfilment problems: skipped subscription boxes with slow support, and a torn seal with a slow refund.", ["ev_012", "ev_023"], "medium"),
      contradicting_evidence_ids: ["ev_022"],
      contradiction_note: "A 5/5 reviewer describes the subscription as easy and beans as always fresh.",
      sampling_bias_note: "Complaint posts are more likely to be written than satisfied ones.",
    },
    {
      id: "theme_3", theme_kind: "complaint", about: "Northline Roasters",
      ...obs("Commenters on two sites complain about a price rise, and one adds that bags no longer reseal.", ["ev_014", "ev_025"], "medium"),
      contradicting_evidence_ids: ["ev_018"],
      contradiction_note: "An older forum post calls Northline consistently good, though it also flags shipping cost.",
      sampling_bias_note: null,
    },
    {
      id: "theme_4", theme_kind: "complaint", about: "Tidewater Coffee Co",
      ...obs("Two commenters criticise Tidewater: bags were far past roast date on arrival, and subscriptions can only be cancelled by emailing support.", ["ev_013", "ev_024"], "medium"),
      contradicting_evidence_ids: [],
      contradiction_note: null,
      sampling_bias_note: "The reviewer who reported cancellation friction still rated the roasts 4/5.",
    },
    {
      id: "theme_5", theme_kind: "switching_trigger", about: "Tidewater Coffee Co and Northline Roasters",
      ...inf("Stale bags and a price increase with worse packaging were each given as reasons to leave a roaster.", "Each source describes a personal switch or intent to switch; three individuals do not establish a general pattern.", ["ev_013", "ev_014", "ev_025"], "low"),
      contradicting_evidence_ids: [],
      contradiction_note: null,
      sampling_bias_note: "Switching stories are self-reported and volunteer-written.",
    },
    {
      id: "theme_6", theme_kind: "unmet_need", about: "Alder & Ash Coffee",
      ...obs("One forum user wants a rotating light-roast decaf subscription and says the single decaf sells out.", ["ev_015"], "low"),
      contradicting_evidence_ids: [],
      contradiction_note: null,
      sampling_bias_note: "A single comment.",
    },
    {
      id: "theme_7", theme_kind: "unmet_need", about: "Alder & Ash Coffee",
      ...obs("A forum user and an editorial note the lack of medium or dark roast options.", ["ev_021", "ev_029"], "medium"),
      contradicting_evidence_ids: [],
      contradiction_note: null,
      sampling_bias_note: "Alder & Ash deliberately roasts light to medium, so this may reflect a non-target audience.",
    },
    {
      id: "theme_8", theme_kind: "praise", about: "Northline Roasters",
      ...obs("Northline is described as consistent and dependable.", ["ev_018", "ev_029"], "medium"),
      contradicting_evidence_ids: ["ev_025"],
      contradiction_note: "A later review reports uneven quality on the last two bags.",
      sampling_bias_note: null,
    },
  ],
};

export const fakeSwotActions: SwotActionsOutput = {
  swot: {
    strengths: [
      { id: "S1", subject: "merchant", ...obs("Alder & Ash states it buys directly from six farms and stamps roast dates on every bag, and an editorial highlights its direct-trade transparency.", ["ev_002", "ev_029"], "high") },
      { id: "S2", subject: "merchant", ...obs("Customers describe Alder & Ash light roasts as flavorful and freshly roasted.", ["ev_011", "ev_022"], "medium") },
      { id: "S3", subject: "merchant", ...obs("Alder & Ash's subscription lets buyers skip, pause and choose 1-, 2- or 4-week cadences, and a reviewer calls it easy.", ["ev_003", "ev_022"], "medium") },
      { id: "S4", subject: "merchant", ...obs("A reviewer and an editorial both single out Alder & Ash's compostable packaging.", ["ev_022", "ev_029"], "medium") },
    ],
    weaknesses: [
      { id: "W1", subject: "merchant", ...obs("One subscriber reports two skipped boxes and four-day support replies from Alder & Ash.", ["ev_012"], "low") },
      { id: "W2", subject: "merchant", ...obs("A reviewer received an Alder & Ash bag with a torn seal and waited two weeks for a refund.", ["ev_023"], "low") },
      { id: "W3", subject: "merchant", ...obs("Alder & Ash offers only light to medium roasts, which an editorial and a forum user flag as limiting.", ["ev_002", "ev_021", "ev_029"], "medium") },
      { id: "W4", subject: "merchant", ...obs("Alder & Ash lists one decaf, which a forum user says sells out.", ["ev_015"], "low") },
    ],
    opportunities: [
      { id: "O1", subject: "market", ...inf("Light-roast buyers who struggle with sour cups are told to buy burr grinders, opening a grinder-bundle route.", "Two independent sources tie sour light roasts to grinding; bundle demand itself has not been observed.", ["ev_016", "ev_031"], "medium") },
      { id: "O2", subject: "market", ...inf("Gift guides pair specialty beans with mugs and biscotti, suggesting demand for coffee gift sets.", "Editorial and storefront sources describe the pairing but do not show purchase volumes.", ["ev_030", "ev_009", "ev_010"], "medium") },
      { id: "O3", subject: "market", ...inf("Stale bags at Tidewater and a price rise at Northline give shoppers reasons to look elsewhere.", "Each reason is a single self-reported account; treat as a hypothesis to test in acquisition messaging.", ["ev_013", "ev_014", "ev_025"], "low") },
      { id: "O4", subject: "market", ...inf("Local cafes stocking whole-bean bags from regional roasters are a possible retail channel.", "One news item shows a cafe stocking local roasters; channel economics are unknown.", ["ev_032"], "low") },
    ],
    threats: [
      { id: "T1", subject: "market", ...obs("Multi-roaster boxes such as Brewbox let shoppers sample several roasters without committing to one.", ["ev_006", "ev_026"], "medium") },
      { id: "T2", subject: "market", ...obs("Tidewater advertises a 15% subscribe discount, above the 10% on Alder & Ash's own plan.", ["ev_005", "ev_003"], "high") },
      { id: "T3", subject: "market", ...obs("Northline offers free shipping over $35 and resealable bags, against a $45 threshold at Alder & Ash.", ["ev_004", "ev_001"], "medium") },
      { id: "T4", subject: "market", ...inf("Capsule products keep appealing to office and convenience buyers despite waste concerns.", "One reviewer calls capsules convenient; the sample is a single comment.", ["ev_027"], "low") },
    ],
  },
  actions: [
    {
      id: "A1", rank: 1, title: "Launch a first-light-roast-setup bundle with Burrmark",
      action: "Offer a Burrmark hand grinder plus a 340 g Ethiopia Guji bag and grind guide as a single bundle.",
      expected_impact: "high", effort: "medium",
      ...inf("Light-roast buyers link sour results to grinding, and Burrmark targets light-roast brewing.", "Grinder demand is inferred from two independent sources; bundle demand is untested.", ["ev_007", "ev_016", "ev_031"], "medium"),
      cheapest_falsifying_experiment: { experiment: "Put the bundle on a waitlist landing page and email it to current subscribers.", metric: "Waitlist sign-ups per email recipient", falsified_if: "Sign-up rate is under 1% after two sends." },
    },
    {
      id: "A3", rank: 2, title: "Test a gift set with Hale Stoneware and Crumb & Co",
      action: "Offer a limited gift set of beans, a Hale mug and a Crumb & Co biscotti box for the gifting season.",
      expected_impact: "medium", effort: "medium",
      ...inf("A gift guide already pairs these brands with specialty beans.", "Editorial pairing shows the concept is familiar, not that it converts.", ["ev_030", "ev_009", "ev_010", "ev_028"], "medium"),
      cheapest_falsifying_experiment: { experiment: "Pre-sell 30 gift sets with a mockup and no inventory commitment.", metric: "Pre-orders per gift-page visitor", falsified_if: "Fewer than 5 pre-orders after two weeks." },
    },
    {
      id: "A2", rank: 3, title: "Publish a skipped-box fix and support response target",
      action: "Add an automatic credit when a subscription box is skipped and publish a support reply-time target.",
      expected_impact: "medium", effort: "low",
      ...obs("Two commenters report fulfilment problems: a skipped box with slow support, and a torn seal with slow refund.", ["ev_012", "ev_023"], "low"),
      cheapest_falsifying_experiment: { experiment: "Audit the last 90 days of subscription orders for skipped boxes and support response times.", metric: "Skipped-box rate and median first reply time", falsified_if: "The audit finds skips and slow replies are rare and the reports are outliers." },
    },
  ],
};

/** Clean report: the consistency stage finds nothing. This is what the fake client returns by default. */
export const fakeConsistency: ConsistencyOutput = {
  findings: [],
  summary: "The three sections agree. Collaboration candidates are complements rather than competitors, the discourse themes keep their caveats, and each action traces to a SWOT item backed by the same evidence.",
};

/** Tampered report: a collaboration partner also listed as a competitor, and an action that ignores the conflict. */
export const fakeConsistencyFindings: ConsistencyOutput = {
  findings: [
    {
      id: "cons_1",
      kind: "ignored_conflict",
      severity: "blocking",
      item_ids: ["collab_2", "comp_3"],
      description: "Kiln & Kettle is proposed as a co-marketing partner in the collaboration section and simultaneously classified as a competitor, and the recommended action treats the partnership as uncontested.",
      resolution: "rewrite",
      rewrite: {
        item_id: "collab_2",
        revised_claim: "Kiln & Kettle's variable-temperature gooseneck kettles are used during pour-over brewing, though this report also lists the brand as a competitor, so the overlap must be resolved before any partnership.",
        lower_confidence_to: "low",
      },
    },
    {
      id: "cons_2",
      kind: "overstated_confidence",
      severity: "warning",
      item_ids: ["theme_6"],
      description: "The decaf unmet-need theme rests on a single forum comment, as its own sampling-bias note says, so it should not carry the weight it is given in the actions.",
      resolution: "flag",
      rewrite: null,
    },
  ],
  summary: "One blocking conflict: a brand appears as both a partner and a competitor. One theme is thinner than its use elsewhere suggests.",
};
