'use strict';

var mongo = require('../index.js')
  , expect = require('chai').expect
  , async = require('async')
  , fs = require('fs')
  , path = require('path')
  , ObjectID = require('mongodb').ObjectID
  , col = null
  , mgr = null
  , TEST_FILE_PATH = path.join(__dirname, './test-file.js');


function removeTestFile (done) {
  if (fs.existsSync(TEST_FILE_PATH)) {
    fs.unlink(TEST_FILE_PATH, done);
  } else {
    done();
  }
}

beforeEach(require('fhlog').silenceIsGolden);

beforeEach(removeTestFile);

afterEach(removeTestFile);

beforeEach(function (done) {
  mgr = mongo.getDatabaseManager({
    mongoUrl: 'mongodb://localhost:27017/test'
  });


  mgr.getCollection('test', function (err, c) {
    expect(err).to.be.null;
    col = c;

    // Empty before each test
    c.remove({}, done);
  });
});

describe('#streamMongoCursorToHttpResponse', function () {

  it('should stream an empty array to file', function (done) {
    col.find({}, function (err, cursor) {

      expect(err).to.be.null;

      var wstr = fs.createWriteStream(TEST_FILE_PATH);

      // Placeholder for the usual function
      wstr.writeHead = function (code, headers) {
        expect(code).to.equal(200);
        expect(headers).to.be.an('object');
        expect(headers['content-type']).to.be.a('string');
      };

      wstr.end = function () {
        setTimeout(function () {
          var res = JSON.parse(
            fs.readFileSync(TEST_FILE_PATH, 'utf8')
          );

          expect(res.length).to.equal(0);

          done();
        }, 100);
      };

      mongo.streamMongoCursorToHttpResponse(cursor, wstr)
    });
  });

  it('should pipe an item in collection to file', function (done) {

    function onInsert (err) {
      expect(err).to.be.null;

      col.find({}, function (err, cursor) {
        expect(err).to.be.null;

        var wstr = fs.createWriteStream(TEST_FILE_PATH);

        // Placeholder for the usual function
        wstr.writeHead = function (code, headers) {
          expect(code).to.equal(200);
          expect(headers).to.be.an('object');
          expect(headers['content-type']).to.be.a('string');
        };

        wstr.end = function () {
          setTimeout(function () {
            var res = JSON.parse(
              fs.readFileSync(TEST_FILE_PATH, 'utf8')
            );

            expect(res[0].name).to.equal('mongo');
            expect(res[0].type).to.equal('db');

            done();
          }, 100);
        };

        mongo.streamMongoCursorToHttpResponse(cursor, wstr);
      });
    }

    col.insert({
      name: 'mongo',
      type: 'db'
    }, onInsert);
  });

});


describe('#getDatabaseManager', function () {

  it('should return a db manager instance', function () {
    expect(
      mongo.getDatabaseManager({
        mongoUrl: 'mongodb://localhost:27017/test'
      })
    ).to.be.an('object');
  });

  it('should throw assertion error', function () {
    expect(function () {
      mongo.getDatabaseManager()
    }).to.throw('AssertionError');
  });

  it('should throw assertion error', function () {
    expect(function () {
      mongo.getDatabaseManager({})
    }).to.throw('AssertionError');
  });

});


describe('#Manager Object', function () {

  describe('#ensureObjectId', function () {
    it('should return the passed in id', function () {
      var id = new ObjectID();

      mgr.ensureObjectId(id, function (err, mid) {
        expect(err).to.be.null;
        expect(mid).to.equal(id);
      });
    });
  });


  describe('#connect', function () {
    it('should connect successfully', function (done) {
      mgr.connect(done);
    });
  });


  describe('#purgeCollection', function () {
    it('should empty the collection', function (done) {
      col.insert({
        name: 'mongo'
      }, function (err) {
        expect(err).to.be.null;

        mgr.purgeCollection('test', function (err) {
          expect(err).to.be.null;

          col.find({}, function (err, cursor) {
            expect(err).to.be.null;

            cursor.count(function (err, c) {
              expect(err).to.be.null;

              expect(c).to.equal(0);
              done();
            });
          });
        });
      });
    });
  });


  describe('#getDbInfo', function () {
    it('should return db info', function (done) {
      mgr.getDbInfo(function (err, info) {
        expect(err).to.be.null;
        expect(info).to.be.an('object');

        done();
      });
    });
  });


  describe('#generateInjectedFunctionsFromArray', function () {
    it('should bind working injected functions to object', function (done) {
      var obj = {};

      mgr.generateInjectedFunctionsFromArray(
        'test',
        obj,
        [
          function insertObject (coll, callback) {
            col.insert({
              name: 'test'
            }, callback);
          },

          function listObjects (coll, callback) {
            coll.find({}).toArray(callback);
          }
        ]
      );

      // Verify functions were bound
      expect(obj.insertObject).to.be.a('function');
      expect(obj.listObjects).to.be.a('function');

      obj.insertObject(function (err) {
        expect(err).to.be.null;

        obj.listObjects(function (err, list) {
          expect(err).to.be.null;
          expect(list).to.have.length(1);

          done();
        });
      });
    });
  });


  describe('#composeInteraction', function () {
    it('should compose a function with a collection injected', function (done) {

      var fn = mgr.composeInteraction('test', function doList (coll, callback) {
        coll.find({}).toArray(callback);
      });

      fn(function (err, items) {
        expect(err).to.be.null;
        expect(items).to.have.length(0);

        done();
      });

    });
  });

  describe('#getCollection', function () {

    it('should get a collection reference successfully', function (done) {
      mgr.getCollection('test', done);
    });

    it('should only open 2 connections for all queries', function (done) {

      mgr = mongo.getDatabaseManager({
        mongoUrl: 'mongodb://localhost:27017/test',
        maxConnections: 2
      });

      var collections = [];

      for (var i=0; i<10; i++) {
        collections.push('test-collection-' + i);
      }

      async.each(collections, function (colName, next) {
        mgr.getCollection(colName, function (err, c) {
          next();
        });
      }, function (err) {
        expect(err).to.be.null;
        expect(mgr.getConnectionCount()).to.equal(2);
        done();
      });
    });

  });

});
