import { makeTokenizer } from './tokenizer'
import { makeParser } from './parser'
import { makeAnalyzer } from './analyzer'
import { makeGenerator } from './generator'

const state = `
back -> Exit!

Exit!

Home*
  one -> One?
  get name -> Home.modal

  @include "./modal.state"

One?
  is user logged in? -> Seven

Seven`


const tokenizer = makeTokenizer()
const tokens = tokenizer.tokenize(state)

const parser = makeParser()
const ast = parser.parse(tokens)

const analyzer = makeAnalyzer()
analyzer.analyze(ast, 'file.state').then(newAst => {
  const generator = makeGenerator()
  console.log(generator.generate(newAst, 'xstate-machine-esm'))
})

