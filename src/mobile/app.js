import React, { Component } from 'react';
import { ApolloProvider } from 'react-apollo';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import { composeWithDevTools } from 'redux-devtools-extension';
import ApolloClient, { createBatchingNetworkInterface } from 'apollo-client';
import { SubscriptionClient, addGraphQLSubscriptions } from 'subscriptions-transport-ws';

import modules from '../client/modules';
import Counter from '../client/modules/counter/containers/counter';

let networkInterface = createBatchingNetworkInterface({
  opts: {
    credentials: "same-origin",
  },
  batchInterval: 20,
  uri: 'http://localhost:8080/graphql',
});

const client = new ApolloClient({
  networkInterface,
});

const wsClient = new SubscriptionClient('ws://localhost:8080/graphql');

networkInterface = addGraphQLSubscriptions(
  networkInterface,
  wsClient,
);

const store = createStore(
  combineReducers({
    apollo: client.reducer(),

    ...modules.reducers
  }),
  {}, // initial state
  composeWithDevTools(
    applyMiddleware(client.middleware()),
  ),
);

export default class Main extends Component {
  render() {
    return (
      <ApolloProvider store={store} client={client}>
        <Counter/>
      </ApolloProvider>
    );
  }
}