import { Interpreter, State } from './index'

const config = {
  name: 'Root',
  states: [
    {
      name: 'MyApp',
      initial: true,
      // parallel: true,
      transitions: [
        { event: 'done.state.MyApp', target: 'Contact' }
      ],
      states: [
        {
          name: 'Home',
          transitions: [
            { event: 'about', target: 'About Contact' }
          ]
        },
        {
          name: 'About'
        },
        {
          name: 'Contact'
        }
      ]
    }
  ]
}

const s = new Interpreter()
s.onTransition(({ matches }) => {
  console.log('Home:', matches('*.Home'))
  console.log('Contact:', matches('*.Contact'))
  console.log('About:', matches('*.About'))
})
s.onEvent(event => {
  console.log('event sent:', event)
})
const state = State.create(config)
s.start(state)
s.send('about')