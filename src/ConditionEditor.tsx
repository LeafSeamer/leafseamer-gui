import {useState} from 'react';
import {parseParameterJson, sameType} from './action-editor.ts';
import type {TypeSpec} from './action-editor.ts';
import {comparisonOperators, comparisonTypes, numericType, referenceKey} from './condition-editor.ts';
import type {Condition, Reference, Value, conditionSources} from './condition-editor.ts';
import type {Copy} from './i18n.ts';

type Sources = ReturnType<typeof conditionSources>;
type Operand = {kind: 'literal'; text: string} | {kind: 'ref'; ref: Reference | null};
type Comparison = Extract<Condition, {kind: 'compare'}>;
type FormCondition = Extract<Condition, {kind: 'literal'}>
  | (Omit<Comparison, 'left' | 'right'> & {left: Operand; right: Operand})
  | {kind: 'all' | 'any'; items: FormCondition[]}
  | {kind: 'not'; item: FormCondition}
  | {kind: 'exists' | 'is_null'; ref: Reference | null};

const constant: FormCondition = {kind: 'literal', value: true};

function toOperand(value: Value): Operand {
  return value.kind === 'ref' ? {kind: 'ref', ref: value} : {kind: 'literal', text: JSON.stringify(value.value)};
}

function fromCondition(condition: Condition): FormCondition {
  switch (condition.kind) {
    case 'literal': return condition;
    case 'compare': return {...condition, left: toOperand(condition.left), right: toOperand(condition.right)};
    case 'all':
    case 'any': return {...condition, items: condition.items.map(fromCondition)};
    case 'not': return {...condition, item: fromCondition(condition.item)};
    case 'exists':
    case 'is_null': return {kind: condition.kind, ref: condition.value};
  }
}

function readOperand(operand: Operand): Value {
  if (operand.kind === 'literal') return {kind: 'literal', value: parseParameterJson(operand.text)};
  return readReference(operand.ref);
}

function readReference(ref: Reference | null): Reference {
  if (ref) return ref;
  throw new Error('condition_operand_missing');
}

function readCondition(condition: FormCondition): Condition {
  switch (condition.kind) {
    case 'literal': return condition;
    case 'compare': return {...condition, left: readOperand(condition.left), right: readOperand(condition.right)};
    case 'all':
    case 'any': return {...condition, items: condition.items.map(readCondition)};
    case 'not': return {...condition, item: readCondition(condition.item)};
    case 'exists':
    case 'is_null': return {kind: condition.kind, value: readReference(condition.ref)};
  }
}

function newCondition(kind: FormCondition['kind']): FormCondition {
  const literal = {kind: 'literal' as const, text: 'true'};
  switch (kind) {
    case 'literal': return constant;
    case 'compare': return {kind, operator: 'eq', value_type: {kind: 'boolean', unit: null}, left: literal, right: literal};
    case 'all':
    case 'any': return {kind, items: [constant]};
    case 'not': return {kind, item: constant};
    case 'exists':
    case 'is_null': return {kind, ref: null};
  }
}

function describe({binding_id, source, pointer}: Reference, copy: Copy) {
  const names = {event: copy.conditionSourceEvent, observation: copy.conditionSourceObservation,
    machine: copy.conditionSourceMachine, step_result: copy.conditionSourceResult};
  return `${binding_id} · ${names[source]} · ${pointer || copy.conditionRoot}`;
}

function ReferenceField({selected, sources, copy, onChange}: {
  selected: Reference | null; sources: Sources; copy: Copy; onChange: (ref: Reference | null) => void;
}) {
  const key = selected ? referenceKey(selected) : '';
  return <label>{copy.conditionProjection}<select value={key}
    onChange={event => onChange(sources.find(source => referenceKey(source.ref) === event.target.value)?.ref ?? null)}>
    <option value="">{copy.conditionChooseProjection}</option>
    {selected && !sources.some(source => referenceKey(source.ref) === key) &&
      <option value={key}>{copy.conditionUnavailable} · {describe(selected, copy)}</option>}
    {sources.map(({ref}) => <option key={referenceKey(ref)} value={referenceKey(ref)}>{describe(ref, copy)}</option>)}
  </select></label>;
}

function OperandFields({label, operand, type, sources, copy, onChange}: {
  label: string; operand: Operand; type: TypeSpec; sources: Sources; copy: Copy; onChange: (operand: Operand) => void;
}) {
  return <fieldset className="condition-operand">
    <legend>{label}</legend>
    <label>{copy.conditionValueKind}<select value={operand.kind} onChange={event => onChange(event.target.value === 'literal' ?
      {kind: 'literal', text: ''} : {kind: 'ref', ref: null})}>
      <option value="literal">{copy.conditionLiteral}</option>
      <option value="ref">{copy.conditionReference}</option>
    </select></label>
    {operand.kind === 'literal' ? <label>{copy.conditionJson}<textarea rows={2} value={operand.text}
      onChange={event => onChange({kind: 'literal', text: event.target.value})}/></label> :
      <ReferenceField selected={operand.ref} sources={sources.filter(source => sameType(source.type, type))}
        copy={copy} onChange={ref => onChange({kind: 'ref', ref})}/>}
  </fieldset>;
}

type NodeProps = {node: FormCondition; sources: Sources; copy: Copy; depth: number; onChange: (node: FormCondition) => void};

function ConditionNode({node, sources, copy, depth, onChange}: NodeProps) {
  const nodeTypes: Record<FormCondition['kind'], string> = {literal: copy.conditionLiteral, compare: copy.conditionCompare,
    all: copy.conditionAll, any: copy.conditionAny, not: copy.conditionNot, exists: copy.conditionExists, is_null: copy.conditionNull};
  const typeLabels = {boolean: copy.conditionBoolean, null: copy.conditionTypeNull, string: copy.conditionString,
    binary64: copy.conditionNumber, integer_string: copy.conditionInteger, json: 'JSON'};
  const ordered = node.kind === 'compare' && numericType(node.value_type.kind);
  return <div className="condition-node">
    <label>{copy.conditionKind}<select value={node.kind} onChange={event => {
      const kind = event.target.value as FormCondition['kind'];
      if ((kind === 'all' || kind === 'any') && (node.kind === 'all' || node.kind === 'any')) onChange({...node, kind});
      else onChange(newCondition(kind));
    }}>
      {Object.entries(nodeTypes).map(([kind, name]) => <option key={kind} value={kind} disabled={depth >= 16 && kind !== 'literal'}>{name}</option>)}
    </select></label>
    {node.kind === 'literal' && <label>{copy.conditionLiteral}<select value={String(node.value)}
      onChange={event => onChange({kind: 'literal', value: event.target.value === 'true'})}>
      <option value="true">{copy.conditionTrue}</option><option value="false">{copy.conditionFalse}</option>
    </select></label>}
    {node.kind === 'compare' && <>
      <label>{copy.conditionType}<select value={node.value_type.kind} onChange={event => {
        const kind = event.target.value as TypeSpec['kind'];
        onChange({...node, value_type: {kind, unit: numericType(kind) ? node.value_type.unit : null}});
      }}>
        {node.value_type.kind === 'json' && <option value="json">{typeLabels.json}</option>}
        {comparisonTypes.map(type => <option key={type} value={type}>{typeLabels[type]}</option>)}
      </select></label>
      {ordered && <label>{copy.conditionUnit}<input value={node.value_type.unit ?? ''} maxLength={128}
        onChange={event => onChange({...node, value_type: {...node.value_type, unit: event.target.value || null}})}/></label>}
      <label>{copy.conditionOperator}<select value={node.operator} onChange={event => onChange({...node, operator: event.target.value as Comparison['operator']})}>
        {comparisonOperators.map((operator, index) => <option key={operator} value={operator} disabled={index >= 2 && !ordered}>
          {['=', '≠', '<', '≤', '>', '≥'][index]}
        </option>)}
      </select></label>
      <div className="condition-operands">
        <OperandFields label={copy.conditionLeft} operand={node.left} type={node.value_type} sources={sources} copy={copy}
          onChange={left => onChange({...node, left})}/>
        <OperandFields label={copy.conditionRight} operand={node.right} type={node.value_type} sources={sources} copy={copy}
          onChange={right => onChange({...node, right})}/>
      </div>
    </>}
    {(node.kind === 'exists' || node.kind === 'is_null') && <ReferenceField selected={node.ref} sources={sources}
      copy={copy} onChange={ref => onChange({...node, ref})}/>}
    {node.kind === 'not' && <ConditionNode node={node.item} sources={sources} copy={copy} depth={depth + 1}
      onChange={item => onChange({...node, item})}/>}
    {(node.kind === 'all' || node.kind === 'any') && <>
      <ol className="condition-children">{node.items.map((item, index) => <li key={index}>
        <ConditionNode node={item} sources={sources} copy={copy} depth={depth + 1}
          onChange={next => onChange({...node, items: node.items.map((value, i) => i === index ? next : value)})}/>
        <button type="button" disabled={node.items.length === 1}
          onClick={() => onChange({...node, items: node.items.filter((_, i) => i !== index)})}>{copy.conditionRemove}</button>
      </li>)}</ol>
      <button type="button" disabled={depth >= 16 || node.items.length >= 256}
        onClick={() => onChange({...node, items: [...node.items, constant]})}>{copy.conditionAdd}</button>
    </>}
  </div>;
}

export function ConditionEditor({label, condition, sources, copy, locked, onEdit}: {
  label: string; condition: Condition; sources: Sources; copy: Copy; locked: boolean; onEdit: (condition: Condition) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return <details className="condition-editor" onToggle={event => { if (event.currentTarget.open) setExpanded(true); }}>
    <summary>{label}</summary>
    {expanded && <ConditionForm key={JSON.stringify(condition)} {...{condition, sources, copy, locked, onEdit}}/>}
  </details>;
}

function ConditionForm({condition, sources, copy, locked, onEdit}: {
  condition: Condition; sources: Sources; copy: Copy; locked: boolean; onEdit: (condition: Condition) => void;
}) {
  const [draft, setDraft] = useState(() => fromCondition(condition));
  const [dirty, setDirty] = useState(false);
  const [invalid, setInvalid] = useState(false);
  function stage() {
    let result: Condition;
    try { result = readCondition(draft); }
    catch { setInvalid(true); return; }
    setInvalid(false);
    onEdit(result);
  }
  return <fieldset className="condition-form" disabled={locked}>
    <ConditionNode node={draft} sources={sources} copy={copy} depth={1} onChange={value => { setDraft(value); setDirty(true); setInvalid(false); }}/>
    {invalid && <p role="alert">{copy.conditionInvalidValue}</p>}
    <div className="actions">
      <button type="button" disabled={!dirty} onClick={stage}>{copy.conditionUpdate}</button>
      <button type="button" disabled={!dirty} onClick={() => { setDraft(fromCondition(condition)); setDirty(false); setInvalid(false); }}>{copy.conditionReset}</button>
    </div>
  </fieldset>;
}
