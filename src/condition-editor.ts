import {validateAutomationModel} from '@leafseamer/sdk/automation-program';
import type {AutomationModels} from '@leafseamer/sdk/automation-program';
import {literalMatches, sameType, selectedActionSources} from './action-editor.ts';
import type {DraftContent} from './binding-selection.ts';
import type {Snapshot} from './session.ts';
import {StepEditError, stepPositions} from './step-editor.ts';

export type Condition = AutomationModels['Condition'];
export type Value = AutomationModels['Value'];
export type Reference = Extract<Value, {kind: 'ref'}>;
export type ConditionTarget = {kind: 'rule-condition'} | {kind: 'transition-condition'; id: string} | {kind: 'step-guard'; step_id: string};
export const comparisonOperators = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;
export const comparisonTypes = ['boolean', 'null', 'string', 'binary64', 'integer_string'] as const;
export const numericType = (kind: string) => kind === 'binary64' || kind === 'integer_string';

export function conditionSources(content: DraftContent, state: Snapshot, target: ConditionTarget) {
  const positions = stepPositions(content);
  const consumer = target.kind === 'step-guard' ? positions.find(entry => entry.step.step_id === target.step_id) : undefined;
  const earlierActions = new Set(positions.filter(entry => consumer && entry.step.kind === 'action' &&
    entry.branch === consumer.branch && entry.rank < consumer.rank).map(entry => entry.step.step_id));

  return selectedActionSources(content, state).flatMap(binding => {
    if (binding.kind !== 'input') return [];
    const {source, producer_step_id, projections} = binding.value;
    if (source === 'step_result' && (!producer_step_id || !earlierActions.has(producer_step_id))) return [];
    return projections.map(({pointer, value_type}) => ({
      ref: {kind: 'ref', source, binding_id: binding.binding_id, pointer} satisfies Reference,
      type: value_type,
    }));
  });
}

export const referenceKey = ({source, binding_id, pointer}: Reference) => JSON.stringify([source, binding_id, pointer]);

function checkCondition(condition: Condition, sources: () => ReturnType<typeof conditionSources>) {
  validateAutomationModel('Condition', condition);
  let available: Map<string, AutomationModels['TypeSpec']> | undefined;
  let nodes = 0;
  function count(depth: number) {
    if (++nodes > 256 || depth > 16) throw new StepEditError('stepEditCondition');
  }
  function valueType(value: Value, depth: number) {
    count(depth);
    if (value.kind === 'literal') return undefined;
    available ??= new Map(sources().map(({ref, type}) => [referenceKey(ref), type]));
    const type = available.get(referenceKey(value));
    if (!type) throw new StepEditError('stepEditSource');
    return type;
  }
  function visit(node: Condition, depth: number) {
    count(depth);
    switch (node.kind) {
      case 'compare': {
        const type = node.value_type;
        if (type.kind === 'json' || (!numericType(type.kind) && (type.unit !== null || !['eq', 'ne'].includes(node.operator)))) {
          throw new StepEditError('stepEditCondition');
        }
        for (const operand of [node.left, node.right]) {
          const actual = valueType(operand, depth + 1);
          if (operand.kind === 'literal' ? !literalMatches(operand.value, type) : !actual || !sameType(actual, type)) {
            throw new StepEditError('stepEditCondition');
          }
        }
        break;
      }
      case 'all':
      case 'any':
        node.items.forEach(item => visit(item, depth + 1));
        break;
      case 'not':
        visit(node.item, depth + 1);
        break;
      case 'exists':
      case 'is_null':
        valueType(node.value, depth + 1);
        break;
    }
  }
  visit(condition, 1);
}

function programConditions(content: DraftContent) {
  const conditions: {target: ConditionTarget; value: Condition}[] = [];
  if (content.program.kind === 'rule') {
    conditions.push({target: {kind: 'rule-condition'}, value: content.program.condition});
  } else {
    for (const transition of content.program.transitions) {
      conditions.push({target: {kind: 'transition-condition', id: transition.transition_id}, value: transition.condition});
    }
  }
  for (const {step} of stepPositions(content)) {
    if (step.kind === 'action') conditions.push({target: {kind: 'step-guard', step_id: step.step_id}, value: step.guard});
  }
  return conditions;
}

export function checkChangedConditions(before: DraftContent, after: DraftContent, state: Snapshot) {
  const previous = new Map(programConditions(before).map(({target, value}) => [JSON.stringify(target), JSON.stringify(value)]));
  const guardActions = new Map(stepPositions(after).flatMap(({step}) => step.kind === 'action' ? [[step.step_id, step.action_binding_id]] : []));
  const approvedActions = new Set(selectedActionSources(after, state).filter(binding => binding.kind === 'action').map(binding => binding.binding_id));
  for (const {target, value} of programConditions(after)) {
    if (previous.get(JSON.stringify(target)) !== JSON.stringify(value)) {
      checkCondition(value, () => conditionSources(after, state, target));
      if (target.kind !== 'step-guard') continue;
      const action = guardActions.get(target.step_id);
      if (!action || !approvedActions.has(action)) throw new StepEditError('stepEditSource');
    }
  }
}
