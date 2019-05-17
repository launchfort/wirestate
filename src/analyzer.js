import * as FS from 'fs'
import * as Path from 'path'
import { promisify } from 'util'
import { makeTokenizer } from './tokenizer'
import { makeParser } from './parser'
import {
  resolveState,
  ScopeNode,
  // eslint-disable-next-line no-unused-vars
  ImportNode,
  // eslint-disable-next-line no-unused-vars
  MachineNode,
  // eslint-disable-next-line no-unused-vars
  StateNode,
  // eslint-disable-next-line no-unused-vars
  UseDirectiveNode
} from './ast-nodes'
import { Cache } from './internal'

const stat = promisify(FS.stat)
const readFile = promisify(FS.readFile)

class SemanticError extends Error {
  constructor (message, { fileName = 'Unknown', line = 0, column = 0 }) {
    super(message)
    this.fileName = fileName
    this.line = line
    this.column = column
  }
}

/** @param {string} eventName */
const normalizeEventName = eventName => {
  return eventName.split(',').map(e => e.trim()).sort().join(',')
}

/**
 * @param {ScopeNode} scopeNode
 * @param {Object} [options]
 * @param {Cache} [options.cache]
 * @param {string[]} [options.dirs] The directories to search for wirestate files
 * @return {Promise<ScopeNode>}
 */
function analyze (scopeNode, { cache, dirs = [] }) {
  if (scopeNode instanceof ScopeNode) {
    return analyzeScopeNode(scopeNode.clone(), { cache, dirs })
  } else {
    throw new Error('Can only analyzie ScopeNode instances')
  }
}

/**
 * @param {string} wireStateFile
 * @param {Object} [options]
 * @param {Cache} [options.cache]
 * @param {string[]} [options.dirs]
 * @return {Promise<ScopeNode>}
 */
async function requireWireStateFile (wireStateFile, { cache, dirs = [] }) {
  dirs = dirs.length === 0 ? [ '.' ] : dirs

  const fileNames = dirs.map(dir => Path.join(dir, wireStateFile))
  const matchResults = await Promise.all(
    fileNames.map(async (fileName) => {
      try {
        const stats = await stat(fileName)
        return stats.isFile()
      } catch (error) {
        if (error.code === 'ENOENT') return false
        throw error
      }
    })
  )
  const firstMatchedFileName = fileNames[matchResults.findIndex(result => result)]

  if (!firstMatchedFileName) {
    throw Object.assign(
      new Error(`WireState file not found\n  File: ${wireStateFile}`),
      { code: 'ENOENT' }
    )
  }

  const cacheHit = await cache.has(wireStateFile)
  if (cacheHit) {
    return cache.get(firstMatchedFileName)
  }

  cache.set(wireStateFile, new Promise((resolve, reject) => {
    readFile(firstMatchedFileName, 'utf8').then(text => {
      const tokenizer = makeTokenizer({ fileName: firstMatchedFileName })
      const parser = makeParser({ fileName: firstMatchedFileName })
      const tokens = tokenizer.tokenize(text)
      const scopeNode = parser.parse(tokens)

      resolve(analyze(scopeNode, { dirs }))
    }, reject)
  }))

  return cache.get(firstMatchedFileName)
}

/**
 * @param {ScopeNode} scopeNode
 * @param {Object} [options]
 * @param {Cache} [options.cache]
 * @param {string[]} [options.dirs]
 */
async function analyzeScopeNode (scopeNode, { cache, dirs = [] }) {
  // Ensure that we have unique machine IDs
  const machineIds = scopeNode.machines.map(machineNode => machineNode.id)
  const uniqueMachineIds = new Set(machineIds)
  for (let machineId of uniqueMachineIds) {
    const k = machineIds.indexOf(machineId)
    const l = machineIds.lastIndexOf(machineId)

    if (k !== l) {
      const machineNode = scopeNode.machines.find(n => n.id === machineId)
      throw new SemanticError(`Duplicate machine\n  Machine ID: "${machineId}"`, {
        fileName: scopeNode.fileName,
        line: machineNode.line,
        column: machineNode.column
      })
    }
  }

  // Analyze the import nodes
  await Promise.all(
    scopeNode.imports.map(async (node) => {
      return analyzeImportNode(node, { cache, dirs })
    })
  )

  // Analyze the machine nodes
  scopeNode._machines = await Promise.all(
    scopeNode.machines.map(machineNode => {
      return analyzeMachineNode(machineNode, { cache })
    })
  )

  return scopeNode
}

/**
 * @param {ImportNode} importNode
 * @param {Object} [options]
 * @param {Cache} [options.cache]
 * @param {string[]} [options.dirs]
 */
async function analyzeImportNode (importNode, { cache, dirs = [] }) {
  const file = importNode.file.startsWith('./') || importNode.file.startsWith('.\\')
    ? Path.join(importNode.parent.fileName, importNode.file)
    : importNode.file

  importNode._file = file

  requireWireStateFile(file, { cache, dirs })

  return importNode
}

/**
 * @param {MachineNode} machineNode
 * @param {Object} options
 * @param {Cache} options.cache
 * @return {Promise<MachineNode>}
 */
async function analyzeMachineNode (machineNode, { cache }) {
  // Ensure that we have unique state IDs
  const stateIds = machineNode.states.map(stateNode => stateNode.id)
  const uniqueStateIds = new Set(stateIds)
  for (let stateId of uniqueStateIds) {
    const k = stateIds.indexOf(stateId)
    const l = stateIds.lastIndexOf(stateId)

    if (k !== l) {
      const stateNode = machineNode.states.find(n => n.id === stateId)
      throw new SemanticError(`Duplicate state\n  State ID: "${stateId}"`, {
        fileName: stateNode.scopeNode.fileName,
        line: stateNode.line,
        column: stateNode.column
      })
    }
  }

  // Ensure that we have unique transitions
  const transitionEvents = machineNode.transitions.map(transitionNode => {
    return normalizeEventName(transitionNode.event)
  })
  const uniqueTransitionEvents = new Set(transitionEvents)
  for (let event of uniqueTransitionEvents) {
    const k = transitionEvents.indexOf(event)
    const l = transitionEvents.lastIndexOf(event)

    if (k !== l) {
      const transitionNode = machineNode.transitions.find(n => {
        return normalizeEventName(n.event) === event
      })
      throw new SemanticError(`Duplicate transition\n  Transition Event: "${transitionNode.event}"`, {
        fileName: machineNode.parent.fileName,
        line: transitionNode.line,
        column: transitionNode.column
      })
    }
  }

  // Ensure that we have unique event protocols
  const protocolEvents = machineNode.eventProtocols.map(eventProtocolNode => {
    return eventProtocolNode.eventName.split(',').map(e => e.trim()).sort().join(',')
  })
  const uniqueProtocolEvents = new Set(protocolEvents)
  for (let event of uniqueProtocolEvents) {
    const k = protocolEvents.indexOf(event)
    const l = protocolEvents.lastIndexOf(event)

    if (k !== l) {
      const eventProtocolNode = machineNode.eventProtocols.find(n => {
        return n.eventName.split(',').map(e => e.trim()).sort().join(',') === event
      })
      throw new SemanticError(`Duplicate event protocol\n  Event Protocol: "${eventProtocolNode.eventName}"`, {
        fileName: machineNode.parent.fileName,
        line: eventProtocolNode.line,
        column: eventProtocolNode.column
      })
    }
  }

  // Ensure transitions target a state that can be reached
  machineNode.transitions.forEach(transitionNode => {
    const stateNode = resolveState(transitionNode)
    if (!stateNode) {
      throw new SemanticError(`Transition target cannot be resolved\n  Transition Target: ${transitionNode.target}`, {
        fileName: machineNode.parent.fileName,
        line: transitionNode.line,
        column: transitionNode.column
      })
    }
  })

  // Verify there is only one initial child state
  if (machineNode.states.filter(n => n.initial).length > 1) {
    const s = machineNode.states.filter(n => n.initial)[1]
    throw new SemanticError(`Only one child state can be marked as initial\n  Machine ID: "${machineNode.id}"`, {
      fileName: machineNode.parent.fileName,
      line: s.line,
      column: s.column
    })
  }

  // If no child state is set to be initial then, set first child state to be initial
  if (machineNode.states.length && !machineNode.states.some(n => n.initial)) {
    machineNode.states[0].initial = true
  }

  // Analyze state nodes
  machineNode._states = await Promise.all(
    machineNode.states.map(stateNode => {
      return analyzeStateNode(stateNode, { cache })
    })
  )

  return machineNode
}

/**
 * @param {StateNode} stateNode
 * @param {Object} options
 * @param {Cache} options.cache
 * @return {Promise<StateNode>}
 */
async function analyzeStateNode (stateNode, { cache }) {
  // Transient states cannot have child states
  if (stateNode.stateType === 'transient' && stateNode.states.length > 0) {
    throw new SemanticError(`Transient states cannot have child states\n  State ID: ${stateNode.id}"`, {
      fileName: stateNode.scopeNode.fileName,
      line: stateNode.states[0].line,
      column: stateNode.states[0].column
    })
  }

  // For atomic states that have child states, set their stateType to "compound"
  if (stateNode.stateType === 'atomic' && stateNode.states.length > 0) {
    stateNode.stateType = 'compound'
  }

  // Ensure that we have unique state IDs
  const stateIds = stateNode.states.map(stateNode => stateNode.id)
  const uniqueStateIds = new Set(stateIds)
  for (let stateId of uniqueStateIds) {
    const k = stateIds.indexOf(stateId)
    const l = stateIds.lastIndexOf(stateId)

    if (k !== l) {
      const childStateNode = stateNode.states.find(n => n.id === stateId)
      throw new SemanticError(`Duplicate state\n  State ID: "${stateId}"`, {
        fileName: stateNode.scopeNode.fileName,
        line: childStateNode.line,
        column: childStateNode.column
      })
    }
  }

  // Ensure that we have unique transitions
  const transitionEvents = stateNode.transitions.map(transitionNode => {
    return normalizeEventName(transitionNode.event)
  })
  const uniqueTransitionEvents = new Set(transitionEvents)
  for (let event of uniqueTransitionEvents) {
    const k = transitionEvents.indexOf(event)
    const l = transitionEvents.lastIndexOf(event)

    if (k !== l) {
      const transitionNode = stateNode.transitions.find(n => {
        return normalizeEventName(n.event) === event
      })
      throw new SemanticError(`Duplicate transition\n  Transition Event: "${transitionNode.event}"`, {
        fileName: stateNode.scopeNode.fileName,
        line: transitionNode.line,
        column: transitionNode.column
      })
    }
  }

  // Ensure that we have unique event protocols
  const protocolEvents = stateNode.eventProtocols.map(eventProtocolNode => {
    return eventProtocolNode.eventName.split(',').map(e => e.trim()).sort().join(',')
  })
  const uniqueProtocolEvents = new Set(protocolEvents)
  for (let event of uniqueProtocolEvents) {
    const k = protocolEvents.indexOf(event)
    const l = protocolEvents.lastIndexOf(event)

    if (k !== l) {
      const eventProtocolNode = stateNode.eventProtocols.find(n => {
        return n.eventName.split(',').map(e => e.trim()).sort().join(',') === event
      })
      throw new SemanticError(`Duplicate event protocol\n  Event Protocol: "${eventProtocolNode.eventName}"`, {
        fileName: stateNode.scopeNode.fileName,
        line: eventProtocolNode.line,
        column: eventProtocolNode.column
      })
    }
  }

  // Ensure transitions target a state that can be reached
  stateNode.transitions.forEach(transitionNode => {
    const childStateNode = resolveState(transitionNode)
    if (!childStateNode) {
      throw new SemanticError(`Transition target cannot be resolved\n  Transition Target: ${transitionNode.target}`, {
        fileName: stateNode.scopeNode.fileName,
        line: transitionNode.line,
        column: transitionNode.column
      })
    }
  })

  // Verify there is only one initial child state
  if (stateNode.states.filter(n => n.initial).length > 1) {
    const s = stateNode.states.filter(n => n.initial)[1]
    throw new SemanticError(`Only one child state can be marked as initial\n  State ID: "${stateNode.id}"`, {
      fileName: stateNode.scopeNode.fileName,
      line: s.line,
      column: s.column
    })
  }

  // If no child state is set to be initial then, set first child state to be initial
  if (stateNode.states.length && !stateNode.states.some(n => n.initial)) {
    stateNode.states[0].initial = true
  }

  // Analyze state nodes
  stateNode._states = await Promise.all(
    stateNode.states.map(stateNode => {
      return analyzeStateNode(stateNode, { cache })
    })
  )

  // Analyze @use directive
  stateNode.useDirective = await analyzeUseDirectiveNode(stateNode.useDirective, { cache })

  return stateNode
}

/**
 * @param {UseDirectiveNode} useDirectiveNode
 * @param {Object} options
 * @param {Cache} options.cache
 * @return {Promise<UseDirectiveNode>}
 */
async function analyzeUseDirectiveNode (useDirectiveNode, { cache }) {
  if (useDirectiveNode) {
    const machineId = useDirectiveNode.machineId
    const scopeNode = useDirectiveNode.parent.scopeNode
    let machineNode = scopeNode.machines.find(machineNode => {
      return machineNode.id === machineId
    })

    if (!machineNode) {
      const importedScopeNodes = await Promise.all(
        scopeNode.imports.map(importNode => cache.get(importNode.file))
      )
      importedScopeNodes.some(scopeNode => {
        machineNode = scopeNode.machines.find(machineNode => {
          return machineNode.id === machineId
        })
        return !!machineNode
      })
    }

    if (!machineNode) {
      throw new SemanticError(`Machine not found\n  Machine ID: ${useDirectiveNode.machineId}`, {
        fileName: useDirectiveNode.parent.scopeNode.fileName,
        line: useDirectiveNode.line,
        column: useDirectiveNode.column
      })
    }

    return useDirectiveNode
  } else {
    return null
  }
}

/**
 * @param {Object} [options]
 * @param {string[]} [options.dirs]
 * @param {string} [options.cacheDir]
 */
export const makeAnalyzer = ({ dirs = [], cacheDir = '.wirestate' } = {}) => {
  const cache = new Cache({ cacheDir })

  return {
    /** @param {ScopeNode} scopeNode */
    analyze (scopeNode) {
      return analyze(scopeNode, { cache, dirs })
    }
  }
}
