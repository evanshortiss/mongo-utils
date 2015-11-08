'use strict';

var mongo = require('mongodb')
  , url = require('url')
  , events = require('events')
  , assert = require('assert')
  , VError = require('verror')
  , ObjectID = require('mongodb').ObjectID
  , Server = require('mongodb').Server
  , MongoClient = mongo.MongoClient
  , log = require('fhlog').getLogger('Mongo Utils')
  , Db = mongo.Db;


/**
 * Streams data from a Mongo cursor to a http response stream
 * @param  {Object} cursor
 * @param  {Object} res
 */
exports.streamMongoCursorToHttpResponse = function (cursor, res) {
  // Stream data without reading all into memory first (efficiency, ftw)
  var stream = cursor.stream()
    , firstWrite = true;

  cursor.count(function (err, c) {
    log.i('Will stream %d objects to the client response', c);
  });

  res.writeHead(200, {
    'content-type': 'application/json'
  });

  stream.on('error', function (err) {
    log.e('Error piping stream response:');
    log.e(err.toString());
    log.e(err.stack);
  });

  stream.on('data', function pipeMongoEntry (entry) {
    if (!firstWrite) {
      // If this isn't the first write we need to add a comma to separate
      // the objects in the JSON string
      res.write(',');
    } else {
      // This is the first write, so start with an Array opening brace
      res.write('[');
      firstWrite = false;
    }

    res.write(JSON.stringify(entry));
  });

  stream.on('end', function onMongoStreamComplete () {
    if (firstWrite) {
      // No data was written so we need to open an array
      res.write('[');
    }

    res.write(']');
    res.end();
  });
};


/**
 * Returns a database manager object to enable interaction with a particluar
 * database.
 * @param  {Object} params [description]
 * @return {Object}        [description]
 */
exports.getDatabaseManager = function (params) {

  assert.equal(
    typeof params,
    'object',
    'params is required and must be an object'
  );

  assert.equal(
    typeof params.mongoUrl,
    'string',
    'params.mongoUrl is required and must be a string'
  );

  var mgr = Object.create(events.EventEmitter.prototype)
    , log = require('fhlog').getLogger('Mongo (' + params.mongoUrl + ')')
    , _connection = null;



  /**
   * Ensure a passed in id param is an ObjectID instance.
   * @param {Mixed} id
   */
  mgr.ensureObjectId = function (id, callback) {
    if (typeof id === 'string') {

      if (typeof callback !== 'function') {
        return new ObjectID(id)
      } else {
        try {
          callback(null, new ObjectID(id));
        } catch(e) {
          callback(
            new VError(e, 'unable to create ObjectID from given id %s', id),
            null
          );
        }
      }

    } else if (callback) {
      callback(null, id);
    } else {
      return id;
    }
  };


  /**
   * Connect to the provided "mongoUrl" in params
   * @param  {Function} callback
   */
  var connect = mgr.connect = function (callback) {

    function onConnected (err, c) {
      if (err) {
        log.e('Failed to connect to MongoDB: %s', err);

        _connection = null;

        callback(
          new VError(err, 'failed to connect to mongodb'),
          null
        );
      } else {
        log.i('Connected successfully. Getting DB info');

        _connection = c;
        callback(null, _connection);
      }
    }

    if (!_connection) {
      log.i('Connecting to database with URL: %s', params.mongoUrl);

      MongoClient.connect(params.mongoUrl, onConnected);
    } else {
      log.d('Called connect, returning existing connection.');

      callback(null, _connection);
    }

  };


  /**
   * Delete an entire collection
   * @param  {String}   name
   * @param  {Function} callback
   */
  mgr.purgeCollection = function (name, callback) {
    getCollection(name, function (err, col) {
      if (err) {
        callback(new VError(err, 'failed to get collection'), null);
      } else {
        col.remove({}, callback);
      }
    });
  };


  /**
   * Get a collection object.
   * @param  {String}   name
   * @param  {Function} callback
   * @return {[type]}
   */
  var getCollection = exports.getCollection = function (name, callback) {
    connect(function (err, conn) {
      if (err) {
        callback(new VError(err, 'cannot connect to database'), null);
      } else {
        callback(null, conn.collection(name));
      }
    });
  };


  /**
   * Disconnect from Mongo.
   * @param  {Function} [callback]
   */
  mgr.disconnect = function (callback) {
    if (_connection) {
      _connection.close();
      _connection = null;
    }

    if (callback) {
      callback(null);
    }
  };


  /**
   * Retrieves database info such as the MongoDB version.
   * @param {String} name
   */
  mgr.getDbInfo = function (callback) {

    callback = callback || function getDbInfoDefaultCallback (err, info) {
      if (err) {
        log.e('Error calling "getDbInfo"');
        log.e(err.toString());
        log.e(err.stack);
      } else {
        log.i('"getDbInfo" result:');
        log.i(JSON.stringify(info, null, 2));
      }
    };

    function onDbOpened (err, db) {
      if (err) {
        callback(new VError(err, 'error opening db'), null);
      } else {
        db.admin().buildInfo(callback);
      }
    }

    function onConnected (err, c) {
      if (err) {
        callback(
          new VError(err, '"getDbInfo" failed to connect to mongo'),
          null
        );
      } else {
        var parsedUrl = url.parse(params.mongoUrl);

        new Db(
          c.databaseName,
          new Server(parsedUrl.hostname, parsedUrl.port)
        ).open(onDbOpened);
      }
    }

    connect(onConnected);
  };


  mgr.generateInjectedFunctionsFromArray = function (
      collectionName,
      target,
      funcs
    ) {

    funcs.forEach(function (fn) {
      target[fn.name] = mgr.composeInteraction(collectionName, fn);
    });

  };


  /**
   * Function that allows straightfoward interaction with the database.
   * Provides a DRY way to connect, get a collection and run a function.
   * @param  {Function} fn
   * @param  {String}   collectionName
   * @return {Function}
   */
  mgr.composeInteraction = function (collectionName, fn) {

    assert.notEqual(
      fn.name,
      '',
      'cannot pass an unamed/annonymous functions to ' +
        'composeInteraction/generateInjectedFunctionsFromArray. ' +
        'functions must have a name like so e.g ' +
        '"function getItemsByName (collection, name, callback) { ... }"'
    );

    return function () {

      var args = Array.prototype.slice.call(arguments)
        , callback = args.slice(args.length - 1, args.length)[0];

      assert.equal(
        typeof callback,
        'function',
        'callback must be passed as the final argument to any function passed ' +
          'through composeInteraction()'
      );

      function onCollection (err, collection) {
        if (err) {
          callback(new VError('failed to get collection'), null);
        } else {
          // Call the original function with the injected collection and args
          fn.apply(fn, [collection].concat(args));
        }
      }

      getCollection(collectionName, onCollection);
    };

  };


  return mgr;
};
