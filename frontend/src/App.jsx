import React from 'react';
import { Provider } from 'react-redux';
import { store } from './store';
import LogInteraction from './components/LogInteraction';

export default function App() {
  return (
    <Provider store={store}>
      <LogInteraction />
    </Provider>
  );
}
