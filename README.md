mongo-easy
==========

A high-level wrapper to make interacting with MongoDB a piece of cake in simple 
applications. No models, no fuss, just simplicity.

## Install

```
npm i mongo-easy
```

## API

## getDatabaseManager(params)
Returns a database _Manager_ instance. _params_ is required and should contain:

* mongoUrl - The database connection string. Must contain the database name e.g 
_mongodb://localhost:27017/database-name_

## ensureObjectId(id, callback)
Ensures the passed in _id_ is an instance of Mongo's ObjectID. If it's a String 
it will attempt to cast it to an ObjectID. Useful for making queries that rely 
on the _\_id_ field. Example:

```javascript
var mongo = require('mongo-easy');

mongo.ensureObjectId('55cb560222cde60000000001', function (err, mid) {
  // mid will be an ObjectID instance, err is null
});

mongo.ensureObjectId('not-a-valid-mongo-id-string', function (err, mid) {
  // err will be returned due to failure to create an ObjectID, mid is null
});
```

## streamMongoCursorToHttpResponse(cursor, response)
Streams a Mongo cursor a HTTP response (OutgoingResponse) stream to avoid 
loading the entire set of results into memory.

Here's a simple example:

```javascript
var mongo = require('mongo-easy');

app.get('/users', function (req, res, next) {
  var testDb = mongo.getDatabaseManager({
    mongoUrl: 'mongodb://localhost:27017/test'
  });

  // Get a collection, connection will occur automatically
  testDb.getCollection('users', function (err, usersCollection) {
    if (err) {
      next(err);
    } else {
      // Get a cursor for all users in the collection
      usersCollection.find({}, function (err, cursor) {
        if (err) {
          next(err);
        } else {
          // Start streaming it back
          mongo.streamMongoCursorToHttpResponse(cursor, res);
        }
      });
    }
  });
})

```


## Manager
Returned by a call to _getDatabaseManager_.

#### connect(callback)
Connect to the database. There's no need to call this since functions that 
require a connection will call it automatically, but it's useful to verify a 
connection can be established.

#### purgeCollection(name, callback)
Delete the entire contents of a collection.

#### getCollection(name, callback)
Get a reference to a collection.

#### disconnect([callback])
Disconnect from MongoDB.

#### getDbInfo
Get information about the database this Manager is connected to. Will return 
something similar to this:

```json
{
  "version": "2.4.6",
  "gitVersion": "b9925db5eac369d77a3a5f5d98a145eaaacd9673",
  "sysInfo": "Linux Fri Nov 20 17:48:28 EST 2009 x86_64 BOOST_LIB_VERSION=1_49",
  "loaderFlags": "-fPIC -pthread -rdynamic",
  "compilerFlags": "-Wnon-virtual-dtor -Woverloaded-virtual -fPIC -fno-strict-aliasing -ggdb -pthread -Wall -Wsign-compare -Wno-unknown-pragmas -Winvalid-pch -Werror -pipe -fno-builtin-memcmp -O3",
  "allocator": "tcmalloc",
  "versionArray": [
    2,
    4,
    6,
    0
  ],
  "javascriptEngine": "V8",
  "bits": 64,
  "debug": false,
  "maxBsonObjectSize": 16777216,
  "ok": 1
}
```

#### composeInteraction(collectionName, func)
Returns a function that will automatically have a collection reference injected 
into it as the first parameter. This saves you the effort of having to get a 
connection and then using that to get the collection reference for each 
function that performs database interaction.

For example:

```javascript

/**
 * file: models/users
 */
var db = require('mongo-easy').getDatabaseManager({
    mongoUrl: 'mongodb://localhost:27017/test'
  });

exports.getUsers = db.composeInteraction(
  'users', 
  // userColl is auto injected!
  function getUserByFirstName (userColl, fname, callback) {
    userColl.findOne({
      firstname: fname
    }, callback);
  }
);


/**
 * file: index.js
 */
var users = require('models/users');

users.getUserByFirstName('john', function (err, user) {
  console.log(err, user);
});

```

### generateInjectedFunctionsFromArray(collectionName, module.exports, funcs)
Uses _composeInteraction_ to automatically "export" the given functions and 
also inject a collection parameter.

```javascript

/**
 * file: models/users
 */
var db = require('mongo-easy').getDatabaseManager({
    mongoUrl: 'mongodb://localhost:27017/test'
  });

db.generateInjectedFunctionsFromArray('users', module.exports, [
  
  function getUserByUsername (collection, name, callback) {
    collection.findOne({
      username: name
    }, callback);
  },

  function getArrayOfUsersByAge (collection, age, callback) {
    collection.find({
      age: age
    }).toArray(callback);
  },

]);

/**
 * file: index.js
 */
var users = require('models/users');

users.getArrayOfUsersByAge(25, function (err, userArray) {
  console.log(err, userArray);
});

users.getUserByUsername('evan', function (err, u) {
  console.log(err, u);
});

```
