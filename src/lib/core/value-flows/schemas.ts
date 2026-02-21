import { z } from 'zod';

export interface Action {
  id?: string;
  label?: string;
  inputOutput?: string | InputOutput;
  pairsWith?: string | Action;
  createResource?: string | CreateResource;
  eventQuantity?: string | EventQuantity;
  accountingEffect?: string | AccountingEffect;
  onhandEffect?: string | OnhandEffect;
  locationEffect?: string | LocationEffect;
  containedEffect?: string | ContainedEffect;
  accountableEffect?: string | AccountableEffect;
  stageEffect?: string | StageEffect;
  stateEffect?: string | StateEffect;
}

export interface ProcessSpecification {
  id?: string;
  image?: string;
  name?: string;
  note?: string;
}

export interface Recipe {
  id?: string;
  primaryOutput?: string | ResourceSpecification;
  recipeIncludes?: string | RecipeProcess;
  name?: string;
  note?: string;
}

export interface RecipeExchange {
  id?: string;
  recipeStipulates?: string | RecipeFlow;
  recipeStipulatesReciprocal?: string | RecipeFlow;
  name?: string;
  note?: string;
}

export interface RecipeFlow {
  id?: string;
  action?: string | Action;
  recipeInputOf?: string | RecipeProcess;
  recipeOutputOf?: string | RecipeProcess;
  recipeClauseOf?: string | RecipeExchange;
  recipeReciprocalClauseOf?: string | RecipeExchange;
  resourceQuantity?: string | Measure;
  effortQuantity?: string | Measure;
  note?: string;
  resourceClassifiedAs?: string;
  resourceConformsTo?: string | ResourceSpecification;
  stage?: string | ProcessSpecification;
  state?: string;
}

export interface RecipeProcess {
  id?: string;
  hasRecipeInput?: string | RecipeFlow;
  hasRecipeOutput?: string | RecipeFlow;
  hasDuration?: string | Measure;
  image?: string;
  name?: string;
  note?: string;
  processClassifiedAs?: string;
  processConformsTo?: string | ProcessSpecification;
}

export interface ResourceSpecification {
  id?: string;
  image?: string;
  imageList?: string;
  name?: string;
  note?: string;
  mediumOfExchange?: boolean;
  substitutable?: boolean;
  defaultUnitOfEffort?: string | Unit;
  defaultUnitOfResource?: string | Unit;
  resourceClassifiedAs?: string;
}

export interface Agreement {
  id?: string;
  created?: string;
  name?: string;
  note?: string;
  stipulates?: string | Commitment;
  stipulatesReciprocal?: string | Commitment;
  realizes?: string | EconomicEvent;
  realizesReciprocal?: string | EconomicEvent;
  bundledIn?: string | AgreementBundle;
}

export interface AgreementBundle {
  id?: string;
  created?: string;
  name?: string;
  note?: string;
  bundles?: string | Agreement;
}

export interface Claim {
  id?: string;
  action?: string | Action;
  provider?: string | Agent;
  receiver?: string | Agent;
  triggeredBy?: string | EconomicEvent;
  due?: string;
  resourceQuantity?: string | Measure;
  effortQuantity?: string | Measure;
  created?: string;
  note?: string;
  finished?: boolean;
  resourceClassifiedAs?: string;
  resourceConformsTo?: string | ResourceSpecification;
}

export interface Commitment {
  id?: string;
  action?: string | Action;
  inputOf?: string | Process;
  outputOf?: string | Process;
  plannedWithin?: string | Plan;
  independentDemandOf?: string | Plan;
  resourceInventoriedAs?: string | EconomicResource;
  provider?: string | Agent;
  receiver?: string | Agent;
  hasBeginning?: string;
  hasEnd?: string;
  hasPointInTime?: string;
  due?: string;
  resourceQuantity?: string | Measure;
  effortQuantity?: string | Measure;
  created?: string;
  note?: string;
  satisfies?: string | Intent;
  finished?: boolean;
  resourceClassifiedAs?: string;
  resourceConformsTo?: string | ResourceSpecification;
  stage?: string | ProcessSpecification;
  state?: string;
  clauseOf?: string | Agreement;
  reciprocalClauseOf?: string | Agreement;
}

export interface Intent {
  id?: string;
  action?: string | Action;
  inputOf?: string | Process;
  outputOf?: string | Process;
  plannedWithin?: string | Plan;
  resourceInventoriedAs?: string | EconomicResource;
  provider?: string | Agent;
  receiver?: string | Agent;
  hasBeginning?: string;
  hasEnd?: string;
  hasPointInTime?: string;
  due?: string;
  resourceQuantity?: string | Measure;
  effortQuantity?: string | Measure;
  availableQuantity?: string | Measure;
  minimumQuantity?: string | Measure;
  image?: string;
  imageList?: string;
  name?: string;
  note?: string;
  finished?: boolean;
  resourceClassifiedAs?: string;
  resourceConformsTo?: string | ResourceSpecification;
  stage?: string | ProcessSpecification;
  state?: string;
}

export interface Plan {
  id?: string;
  planIncludes?: string | Process | Commitment | Intent;
  hasIndependentDemand?: string | Commitment;
  due?: string;
  created?: string;
  name?: string;
  note?: string;
}

export interface Process {
  id?: string;
  hasInput?: string | EconomicEvent | Commitment | Intent;
  hasOutput?: string | EconomicEvent | Commitment | Intent;
  plannedWithin?: string | Plan;
  inScopeOf?: string | Agent;
  hasBeginning?: string;
  hasEnd?: string;
  name?: string;
  note?: string;
  finished?: boolean;
  basedOn?: string | ProcessSpecification;
  classifiedAs?: string;
}

export interface Proposal {
  id?: string;
  hasBeginning?: string;
  hasEnd?: string;
  unitBased?: boolean;
  purpose?: string | ProposalPurpose;
  created?: string;
  eligibleLocation?: string | SpatialThing;
  name?: string;
  note?: string;
  publishes?: string | Intent;
  reciprocal?: string | Intent;
  proposedTo?: string | Agent;
  listedIn?: string | ProposalList;
}

export interface ProposalList {
  id?: string;
  created?: string;
  name?: string;
  note?: string;
  proposedTo?: string | Agent;
  lists?: string | Proposal;
}

export interface Agent {
  id?: string;
  primaryLocation?: string | SpatialThing;
  image?: string;
  name?: string;
  note?: string;
}

export interface BatchLotRecord {
  id?: string;
  batchLotCode?: string;
  expirationDate?: string;
}

export interface EcologicalAgent {
  id?: string;
  classifiedAs?: string;
}

export interface EconomicEvent {
  id?: string;
  action?: string | Action;
  inputOf?: string | Process;
  outputOf?: string | Process;
  resourceInventoriedAs?: string | EconomicResource;
  toResourceInventoriedAs?: string | EconomicResource;
  provider?: string | Agent;
  receiver?: string | Agent;
  corrects?: string | EconomicEvent;
  settles?: string | Claim;
  hasBeginning?: string;
  hasEnd?: string;
  hasPointInTime?: string;
  resourceQuantity?: string | Measure;
  effortQuantity?: string | Measure;
  created?: string;
  toLocation?: string | SpatialThing;
  image?: string;
  note?: string;
  fulfills?: string | Commitment;
  satisfies?: string | Intent;
  resourceClassifiedAs?: string;
  resourceConformsTo?: string | ResourceSpecification;
  state?: string;
  realizationOf?: string | Agreement;
  reciprocalRealizationOf?: string | Agreement;
}

export interface EconomicResource {
  id?: string;
  containedIn?: string | EconomicResource;
  contains?: string | EconomicResource;
  primaryAccountable?: string | Agent;
  accountingQuantity?: string | Measure;
  onhandQuantity?: string | Measure;
  currentLocation?: string | SpatialThing;
  currentVirtualLocation?: string;
  currentCurrencyLocation?: string;
  image?: string;
  imageList?: string;
  name?: string;
  note?: string;
  trackingIdentifier?: string;
  ofBatchLot?: string | BatchLotRecord;
  unitOfEffort?: string | Unit;
  classifiedAs?: string;
  conformsTo?: string | ResourceSpecification;
  stage?: string | ProcessSpecification;
  state?: string;
}

export interface Organization {
  id?: string;
  classifiedAs?: string;
}

export interface Person {
  id?: string;
}

export interface Measure {
  id?: string;
  hasNumericalValue?: string;
  hasUnit?: string | Unit;
}

export interface SpatialThing {
  id?: string;
  long?: string;
  lat?: string;
  alt?: string;
  mappableAddress?: string;
  hasDetailedGeometry?: string;
  name?: string;
  note?: string;
}

export interface Unit {
  id?: string;
  omUnitIdentifier?: string;
  label?: string;
  symbol?: string;
  classifiedAs?: string;
}

export interface InputOutput {
  id?: string;
}

export interface CreateResource {
  id?: string;
}

export interface EventQuantity {
  id?: string;
}

export interface AccountingEffect {
  id?: string;
}

export interface OnhandEffect {
  id?: string;
}

export interface LocationEffect {
  id?: string;
}

export interface ContainedEffect {
  id?: string;
}

export interface AccountableEffect {
  id?: string;
}

export interface StageEffect {
  id?: string;
}

export interface StateEffect {
  id?: string;
}

export interface ProposalPurpose {
  id?: string;
}


// --- Zod Schemas ---

export const ActionSchema: z.ZodType<Action> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  label: z.string().optional(),
  inputOutput: z.union([z.string(), z.lazy(() => InputOutputSchema)]).optional(),
  pairsWith: z.union([z.string(), z.lazy(() => ActionSchema)]).optional(),
  createResource: z.union([z.string(), z.lazy(() => CreateResourceSchema)]).optional(),
  eventQuantity: z.union([z.string(), z.lazy(() => EventQuantitySchema)]).optional(),
  accountingEffect: z.union([z.string(), z.lazy(() => AccountingEffectSchema)]).optional(),
  onhandEffect: z.union([z.string(), z.lazy(() => OnhandEffectSchema)]).optional(),
  locationEffect: z.union([z.string(), z.lazy(() => LocationEffectSchema)]).optional(),
  containedEffect: z.union([z.string(), z.lazy(() => ContainedEffectSchema)]).optional(),
  accountableEffect: z.union([z.string(), z.lazy(() => AccountableEffectSchema)]).optional(),
  stageEffect: z.union([z.string(), z.lazy(() => StageEffectSchema)]).optional(),
  stateEffect: z.union([z.string(), z.lazy(() => StateEffectSchema)]).optional(),
}));

export const ProcessSpecificationSchema: z.ZodType<ProcessSpecification> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  image: z.string().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
}));

export const RecipeSchema: z.ZodType<Recipe> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  primaryOutput: z.union([z.string(), z.lazy(() => ResourceSpecificationSchema)]).optional(),
  recipeIncludes: z.union([z.string(), z.lazy(() => RecipeProcessSchema)]).optional(),
  name: z.string().optional(),
  note: z.string().optional(),
}));

export const RecipeExchangeSchema: z.ZodType<RecipeExchange> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  recipeStipulates: z.union([z.string(), z.lazy(() => RecipeFlowSchema)]).optional(),
  recipeStipulatesReciprocal: z.union([z.string(), z.lazy(() => RecipeFlowSchema)]).optional(),
  name: z.string().optional(),
  note: z.string().optional(),
}));

export const RecipeFlowSchema: z.ZodType<RecipeFlow> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  action: z.union([z.string(), z.lazy(() => ActionSchema)]).optional(),
  recipeInputOf: z.union([z.string(), z.lazy(() => RecipeProcessSchema)]).optional(),
  recipeOutputOf: z.union([z.string(), z.lazy(() => RecipeProcessSchema)]).optional(),
  recipeClauseOf: z.union([z.string(), z.lazy(() => RecipeExchangeSchema)]).optional(),
  recipeReciprocalClauseOf: z.union([z.string(), z.lazy(() => RecipeExchangeSchema)]).optional(),
  resourceQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  effortQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  note: z.string().optional(),
  resourceClassifiedAs: z.string().optional(),
  resourceConformsTo: z.union([z.string(), z.lazy(() => ResourceSpecificationSchema)]).optional(),
  stage: z.union([z.string(), z.lazy(() => ProcessSpecificationSchema)]).optional(),
  state: z.string().optional(),
}));

export const RecipeProcessSchema: z.ZodType<RecipeProcess> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  hasRecipeInput: z.union([z.string(), z.lazy(() => RecipeFlowSchema)]).optional(),
  hasRecipeOutput: z.union([z.string(), z.lazy(() => RecipeFlowSchema)]).optional(),
  hasDuration: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  image: z.string().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  processClassifiedAs: z.string().optional(),
  processConformsTo: z.union([z.string(), z.lazy(() => ProcessSpecificationSchema)]).optional(),
}));

export const ResourceSpecificationSchema: z.ZodType<ResourceSpecification> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  image: z.string().optional(),
  imageList: z.string().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  mediumOfExchange: z.boolean().optional(),
  substitutable: z.boolean().optional(),
  defaultUnitOfEffort: z.union([z.string(), z.lazy(() => UnitSchema)]).optional(),
  defaultUnitOfResource: z.union([z.string(), z.lazy(() => UnitSchema)]).optional(),
  resourceClassifiedAs: z.string().optional(),
}));

export const AgreementSchema: z.ZodType<Agreement> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  created: z.string().datetime().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  stipulates: z.union([z.string(), z.lazy(() => CommitmentSchema)]).optional(),
  stipulatesReciprocal: z.union([z.string(), z.lazy(() => CommitmentSchema)]).optional(),
  realizes: z.union([z.string(), z.lazy(() => EconomicEventSchema)]).optional(),
  realizesReciprocal: z.union([z.string(), z.lazy(() => EconomicEventSchema)]).optional(),
  bundledIn: z.union([z.string(), z.lazy(() => AgreementBundleSchema)]).optional(),
}));

export const AgreementBundleSchema: z.ZodType<AgreementBundle> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  created: z.string().datetime().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  bundles: z.union([z.string(), z.lazy(() => AgreementSchema)]).optional(),
}));

export const ClaimSchema: z.ZodType<Claim> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  action: z.union([z.string(), z.lazy(() => ActionSchema)]).optional(),
  provider: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  receiver: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  triggeredBy: z.union([z.string(), z.lazy(() => EconomicEventSchema)]).optional(),
  due: z.string().datetime().optional(),
  resourceQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  effortQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  created: z.string().datetime().optional(),
  note: z.string().optional(),
  finished: z.boolean().optional(),
  resourceClassifiedAs: z.string().optional(),
  resourceConformsTo: z.union([z.string(), z.lazy(() => ResourceSpecificationSchema)]).optional(),
}));

export const CommitmentSchema: z.ZodType<Commitment> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  action: z.union([z.string(), z.lazy(() => ActionSchema)]).optional(),
  inputOf: z.union([z.string(), z.lazy(() => ProcessSchema)]).optional(),
  outputOf: z.union([z.string(), z.lazy(() => ProcessSchema)]).optional(),
  plannedWithin: z.union([z.string(), z.lazy(() => PlanSchema)]).optional(),
  independentDemandOf: z.union([z.string(), z.lazy(() => PlanSchema)]).optional(),
  resourceInventoriedAs: z.union([z.string(), z.lazy(() => EconomicResourceSchema)]).optional(),
  provider: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  receiver: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  hasBeginning: z.string().datetime().optional(),
  hasEnd: z.string().datetime().optional(),
  hasPointInTime: z.string().datetime().optional(),
  due: z.string().datetime().optional(),
  resourceQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  effortQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  created: z.string().datetime().optional(),
  note: z.string().optional(),
  satisfies: z.union([z.string(), z.lazy(() => IntentSchema)]).optional(),
  finished: z.boolean().optional(),
  resourceClassifiedAs: z.string().optional(),
  resourceConformsTo: z.union([z.string(), z.lazy(() => ResourceSpecificationSchema)]).optional(),
  stage: z.union([z.string(), z.lazy(() => ProcessSpecificationSchema)]).optional(),
  state: z.string().optional(),
  clauseOf: z.union([z.string(), z.lazy(() => AgreementSchema)]).optional(),
  reciprocalClauseOf: z.union([z.string(), z.lazy(() => AgreementSchema)]).optional(),
}));

export const IntentSchema: z.ZodType<Intent> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  action: z.union([z.string(), z.lazy(() => ActionSchema)]).optional(),
  inputOf: z.union([z.string(), z.lazy(() => ProcessSchema)]).optional(),
  outputOf: z.union([z.string(), z.lazy(() => ProcessSchema)]).optional(),
  plannedWithin: z.union([z.string(), z.lazy(() => PlanSchema)]).optional(),
  resourceInventoriedAs: z.union([z.string(), z.lazy(() => EconomicResourceSchema)]).optional(),
  provider: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  receiver: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  hasBeginning: z.string().datetime().optional(),
  hasEnd: z.string().datetime().optional(),
  hasPointInTime: z.string().datetime().optional(),
  due: z.string().datetime().optional(),
  resourceQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  effortQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  availableQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  minimumQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  image: z.string().optional(),
  imageList: z.string().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  finished: z.boolean().optional(),
  resourceClassifiedAs: z.string().optional(),
  resourceConformsTo: z.union([z.string(), z.lazy(() => ResourceSpecificationSchema)]).optional(),
  stage: z.union([z.string(), z.lazy(() => ProcessSpecificationSchema)]).optional(),
  state: z.string().optional(),
}));

export const PlanSchema: z.ZodType<Plan> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  planIncludes: z.union([z.string(), z.lazy(() => ProcessSchema), z.lazy(() => CommitmentSchema), z.lazy(() => IntentSchema)]).optional(),
  hasIndependentDemand: z.union([z.string(), z.lazy(() => CommitmentSchema)]).optional(),
  due: z.string().datetime().optional(),
  created: z.string().datetime().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
}));

export const ProcessSchema: z.ZodType<Process> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  hasInput: z.union([z.string(), z.lazy(() => EconomicEventSchema), z.lazy(() => CommitmentSchema), z.lazy(() => IntentSchema)]).optional(),
  hasOutput: z.union([z.string(), z.lazy(() => EconomicEventSchema), z.lazy(() => CommitmentSchema), z.lazy(() => IntentSchema)]).optional(),
  plannedWithin: z.union([z.string(), z.lazy(() => PlanSchema)]).optional(),
  inScopeOf: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  hasBeginning: z.string().datetime().optional(),
  hasEnd: z.string().datetime().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  finished: z.boolean().optional(),
  basedOn: z.union([z.string(), z.lazy(() => ProcessSpecificationSchema)]).optional(),
  classifiedAs: z.string().optional(),
}));

export const ProposalSchema: z.ZodType<Proposal> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  hasBeginning: z.string().datetime().optional(),
  hasEnd: z.string().datetime().optional(),
  unitBased: z.boolean().optional(),
  purpose: z.union([z.string(), z.lazy(() => ProposalPurposeSchema)]).optional(),
  created: z.string().datetime().optional(),
  eligibleLocation: z.union([z.string(), z.lazy(() => SpatialThingSchema)]).optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  publishes: z.union([z.string(), z.lazy(() => IntentSchema)]).optional(),
  reciprocal: z.union([z.string(), z.lazy(() => IntentSchema)]).optional(),
  proposedTo: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  listedIn: z.union([z.string(), z.lazy(() => ProposalListSchema)]).optional(),
}));

export const ProposalListSchema: z.ZodType<ProposalList> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  created: z.string().datetime().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  proposedTo: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  lists: z.union([z.string(), z.lazy(() => ProposalSchema)]).optional(),
}));

export const AgentSchema: z.ZodType<Agent> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  primaryLocation: z.union([z.string(), z.lazy(() => SpatialThingSchema)]).optional(),
  image: z.string().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
}));

export const BatchLotRecordSchema: z.ZodType<BatchLotRecord> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  batchLotCode: z.string().optional(),
  expirationDate: z.string().datetime().optional(),
}));

export const EcologicalAgentSchema: z.ZodType<EcologicalAgent> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  classifiedAs: z.string().optional(),
}));

export const EconomicEventSchema: z.ZodType<EconomicEvent> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  action: z.union([z.string(), z.lazy(() => ActionSchema)]).optional(),
  inputOf: z.union([z.string(), z.lazy(() => ProcessSchema)]).optional(),
  outputOf: z.union([z.string(), z.lazy(() => ProcessSchema)]).optional(),
  resourceInventoriedAs: z.union([z.string(), z.lazy(() => EconomicResourceSchema)]).optional(),
  toResourceInventoriedAs: z.union([z.string(), z.lazy(() => EconomicResourceSchema)]).optional(),
  provider: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  receiver: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  corrects: z.union([z.string(), z.lazy(() => EconomicEventSchema)]).optional(),
  settles: z.union([z.string(), z.lazy(() => ClaimSchema)]).optional(),
  hasBeginning: z.string().datetime().optional(),
  hasEnd: z.string().datetime().optional(),
  hasPointInTime: z.string().datetime().optional(),
  resourceQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  effortQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  created: z.string().datetime().optional(),
  toLocation: z.union([z.string(), z.lazy(() => SpatialThingSchema)]).optional(),
  image: z.string().optional(),
  note: z.string().optional(),
  fulfills: z.union([z.string(), z.lazy(() => CommitmentSchema)]).optional(),
  satisfies: z.union([z.string(), z.lazy(() => IntentSchema)]).optional(),
  resourceClassifiedAs: z.string().optional(),
  resourceConformsTo: z.union([z.string(), z.lazy(() => ResourceSpecificationSchema)]).optional(),
  state: z.string().optional(),
  realizationOf: z.union([z.string(), z.lazy(() => AgreementSchema)]).optional(),
  reciprocalRealizationOf: z.union([z.string(), z.lazy(() => AgreementSchema)]).optional(),
}));

export const EconomicResourceSchema: z.ZodType<EconomicResource> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  containedIn: z.union([z.string(), z.lazy(() => EconomicResourceSchema)]).optional(),
  contains: z.union([z.string(), z.lazy(() => EconomicResourceSchema)]).optional(),
  primaryAccountable: z.union([z.string(), z.lazy(() => AgentSchema)]).optional(),
  accountingQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  onhandQuantity: z.union([z.string(), z.lazy(() => MeasureSchema)]).optional(),
  currentLocation: z.union([z.string(), z.lazy(() => SpatialThingSchema)]).optional(),
  currentVirtualLocation: z.string().optional(),
  currentCurrencyLocation: z.string().optional(),
  image: z.string().optional(),
  imageList: z.string().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  trackingIdentifier: z.string().optional(),
  ofBatchLot: z.union([z.string(), z.lazy(() => BatchLotRecordSchema)]).optional(),
  unitOfEffort: z.union([z.string(), z.lazy(() => UnitSchema)]).optional(),
  classifiedAs: z.string().optional(),
  conformsTo: z.union([z.string(), z.lazy(() => ResourceSpecificationSchema)]).optional(),
  stage: z.union([z.string(), z.lazy(() => ProcessSpecificationSchema)]).optional(),
  state: z.string().optional(),
}));

export const OrganizationSchema: z.ZodType<Organization> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  classifiedAs: z.string().optional(),
}));

export const PersonSchema: z.ZodType<Person> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const MeasureSchema: z.ZodType<Measure> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  hasNumericalValue: z.string().optional(),
  hasUnit: z.union([z.string(), z.lazy(() => UnitSchema)]).optional(),
}));

export const SpatialThingSchema: z.ZodType<SpatialThing> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  long: z.string().optional(),
  lat: z.string().optional(),
  alt: z.string().optional(),
  mappableAddress: z.string().optional(),
  hasDetailedGeometry: z.string().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
}));

export const UnitSchema: z.ZodType<Unit> = z.lazy(() => z.object({
  id: z.string().url().optional(),
  omUnitIdentifier: z.string().optional(),
  label: z.string().optional(),
  symbol: z.string().optional(),
  classifiedAs: z.string().optional(),
}));

export const InputOutputSchema: z.ZodType<InputOutput> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const CreateResourceSchema: z.ZodType<CreateResource> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const EventQuantitySchema: z.ZodType<EventQuantity> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const AccountingEffectSchema: z.ZodType<AccountingEffect> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const OnhandEffectSchema: z.ZodType<OnhandEffect> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const LocationEffectSchema: z.ZodType<LocationEffect> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const ContainedEffectSchema: z.ZodType<ContainedEffect> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const AccountableEffectSchema: z.ZodType<AccountableEffect> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const StageEffectSchema: z.ZodType<StageEffect> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const StateEffectSchema: z.ZodType<StateEffect> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

export const ProposalPurposeSchema: z.ZodType<ProposalPurpose> = z.lazy(() => z.object({
  id: z.string().url().optional(),
}));

