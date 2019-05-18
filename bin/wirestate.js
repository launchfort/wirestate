#! /usr/bin/env node

const WireState = require('../lib/index')

/**
 * Read a commandline option.
 *
 * @example
 * const args = process.args.slice(2)
 * // Required (i.e. program --name myname)
 * const name = readOption([ '--name' ], args)
 * // Optional list option (i.e. program --flavor value --flavor value2)
 * const flavor = readOption([ '--flavor' ], args, { defaultValue: [] })
 * // Optional flag option (i.e. program --flag)
 * const flag = readOption([ '--flg' ], args, { defaultValue: false })
 * @param {string[]} names The valid option names on the command line
 * @param {string[]} args The command line arguments without the program and script name
 * @param {Object} [options]
 * @param {any} [options.defaultValue] The defaultValue of the option
 * @return {any[]|any}
 */
function readOption (names, args, { defaultValue = null }) {
  let argValues = [].concat(defaultValue)
  let argCount = 0

  names.forEach(name => {
    const index = args.findIndex(arg => arg.startsWith(name))

    if (index >= 0) {
      let value = args[index].indexOf('=') >= 0
        ? args[index].split('=').slice(1).join('=')
        : args[index + 1]

      if (typeof defaultValue === 'boolean') {
        value = true
      } else if (!value || value.startsWith('-')) {
        throw new Error(`Option ${name} must have a value`)
      }

      if (argCount === 0) {
        argValues = [ value ]
      } else {
        argValues = argValues.concat(value)
      }

      argCount += 1
    }
  })

  if (Array.isArray(defaultValue)) {
    return argValues
  } else {
    if (argCount === 1) {
      return argValues[0]
    } else if (argCount === 0 && (defaultValue === null || defaultValue === undefined)) {
      throw new Error(`Option ${names} is required`)
    } else {
      throw new Error(`Option ${names} only allows one value`)
    }
  }
}

async function generate (inputFileName, { generatorName, dir, cacheDir }) {
  return WireState.compile(inputFileName, { generatorName, dir, cacheDir })
}

function main () {
  const args = process.argv.slice(2)
  const help = () => {
    console.log(`Usage:
wirestate {input file} [--output {output type}]`
    )
  }

  if (args.some(arg => [ '--help', '-h' ].indexOf(arg) >= 0)) {
    help()
    process.exit(0)
  }

  const inputFileName = args.find(arg => !arg.startsWith('-'))
  const dir = readOption([ '--dir' ], args, { defaultValue: '' })
  const generatorName = readOption([ '--generator' ], args, { defaultValue: 'json' })
  const cacheDir = readOption([ '--cacheDir' ], args, { defaultValue: '.wirestate' })

  if (!inputFileName) {
    help()
    process.exit(20)
  }

  return generate(inputFileName, { dir, generatorName, cacheDir })
}

// Entry ---------

main().then(output => {
  return new Promise((resolve, reject) => {
    process.stdout.write(output, 'utf8', (error) => {
      error ? reject(error) : resolve()
    })
  })
}).catch(error => {
  console.error(error)
  process.exit(10)
})
