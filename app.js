//. app.js

var express = require( 'express' ),
    basicAuth = require( 'basic-auth-connect' ),
    i18n = require( 'i18n' ),
    multer = require( 'multer' ),
    bodyParser = require( 'body-parser' ),
    fs = require( 'fs' ),
    ejs = require( 'ejs' ),
    cloudantlib = require( '@cloudant/cloudant' ),
    uuidv1 = require( 'uuid/v1' ),
    app = express();

//. #8
var QRCode = require( 'qrcode' );

var settings = require( './settings' );

var db = null;
var db_url = null;
var cloudant = null;
if( settings.db_url && settings.db_username && settings.db_password ){
  db_url = settings.db_url;
  cloudant = cloudantlib( { account: settings.db_username, password: settings.db_password, url: db_url } );
  if( cloudant ){
    cloudant.db.get( settings.db_name, function( err, body ){
      if( err ){
        if( err.statusCode == 404 ){
          cloudant.db.create( settings.db_name, function( err, body ){
            if( err ){
              db = null;
            }else{
              db = cloudant.db.use( settings.db_name );
              insertQueryIndex();
            }
          });
        }else{
          db = cloudant.db.use( settings.db_name );
          insertQueryIndex();
        }
      }else{
        db = cloudant.db.use( settings.db_name );
        insertQueryIndex();
      }
    });
  }
}

/*
app.all( '/view', basicAuth( function( user, pass ){
  if( settings.admin_username && settings.admin_password ){
    return ( settings.admin_username === user && settings.admin_password === pass );
  }else{
    return false;
  }
}));
*/

app.use( multer( { dest: './tmp/' } ).single( 'image' ) );
app.use( bodyParser.urlencoded( { extended: true } ) );
app.use( bodyParser.json() );
app.use( express.Router() );
app.use( express.static( __dirname + '/public' ) );

app.set( 'views', __dirname + '/views' );
app.set( 'view engine', 'ejs' );

//. i18n
i18n.configure({
  locales: ['ja', 'en'],
  directory: __dirname + '/locales'
});
app.use( i18n.init );

app.get( '/', function( req, res ){
  var id = req.query.id;
  if( id && db ){
    db.get( id, { include_docs: true }, function( err, body, header ){
      if( err ){
        res.render( 'index', { id: id, doodle: null } );
      }else{
        res.render( 'index', { id: id, doodle: body } );
      }
    });
  }else{
    res.render( 'index', { doodle: null } );
  }
});

app.get( '/doodle/:id', function( req, res ){
  var id = req.params.id;
  var doodle = {};
  if( db ){
    db.get( id, { include_docs: true }, function( err, body, header ){
      if( err ){
        res.render( 'doodle', { id: id, doodle: doodle } );
      }else{
        res.render( 'doodle', { id: id, doodle: body } );
      }
    });
  }else{
    res.render( 'doodle', { id: id, doodle: doodle } );
  }
});

//. #8
app.post( '/qrcode', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var data = JSON.parse( '[' + req.body.data + ']' );

    if( data ){
      var filepath = './tmp/' + uuidv1() + '.png';
      //. https://www.npmjs.com/package/qrcode
      QRCode.toFile( 
        filepath,
        [ { data: data, mode: 'byte' } ],
        function( err, result ){
          if( err ){
            console.log( err );
            fs.unlink( filepath, function( err ){} );
          }else{
            var bin = fs.readFileSync( filepath );
            fs.unlink( filepath, function( err ){} );
            res.contentType( 'image/png' );
            res.header( { 'Content-Disposition': 'inline' } );
            res.end( bin, 'binary' );
          }
        }
      );
    }else{
      var p = JSON.stringify( { status: false, error: 'no image data.' }, null, 2 );
      res.status( 400 );
      res.write( p );
      res.end();
    }
  }else{
    var p = JSON.stringify( { status: false, error: 'db not ready.' }, null, 2 );
    res.status( 400 );
    res.write( p );
    res.end();
  }
});

app.get( '/view', function( req, res ){
  var images = [];
  var id = req.query.id;
  if( db && id ){
    db.find( { selector: { uuid: { "$eq": id } }, fields: [ "_id", "_rev", "filename", "type", "title", "timestamp", "uuid" ] }, function( err, result ){
      if( err ){
        res.render( 'view', { id: id, y: 0, m: 0, images: images, error: err } );
      }else{
        //. 対象年＆月を特定
        var dt = new Date();
        var y = dt.getFullYear();
        var m = dt.getMonth() + 1;
        var offset = ( dt.getTimezoneOffset() + 540 ) * 60 * 1000;
        if( req.query.y ){
          try{
            y = parseInt( req.query.y );
          }catch( e ){
          }
        }
        if( req.query.m ){
          try{
            m = parseInt( req.query.m );
          }catch( e ){
          }
        }

        var total = result.docs.length;
        var images = [];
        result.docs.forEach( function( doc ){
          if( doc._id.indexOf( '_' ) !== 0 && doc.type && doc.type == 'image' ){
            //. このままだと us-south タイムゾーンで日付計算されるので日本時間のカレンダーに合わなくなるのでオフセットを処理する
            //dt.setTime( parseInt( doc.timestamp ) )
            dt.setTime( parseInt( doc.timestamp ) + offset )

            var y0 = dt.getFullYear();
            var m0 = dt.getMonth() + 1;
            var d = dt.getDate();
            if( y == y0 && m == m0 ){
              doc.y = y;
              doc.m = m;
              doc.d = d;
              images.push( doc );
            }
          }
        });

        images.sort( sortByTimestampRev );
        res.render( 'view', { id: id, y: y, m: m, images: images } );
      }
    });
  }else{
    res.render( 'view', { id: id, y: 0, m: 0, images: images, error: 'db and/or id not found.' } );
  }
});


app.post( '/image', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var imgpath = req.file.path;
    var imgtype = req.file.mimetype;
    //var imgsize = req.file.size;
    var ext = imgtype.split( "/" )[1];
    var imgfilename = req.file.filename;
    var filename = req.file.originalname;

    var image_id = req.body._id;
    var image_rev = null;
    if( image_id ){
      image_rev = req.body._rev;
    }else{
      image_id = uuidv1();
    }
    var img = fs.readFileSync( imgpath );
    var img64 = new Buffer( img ).toString( 'base64' );

    var params = {
      _id: image_id,
      filename: filename,
      type: 'image',
      timestamp: req.body.timestamp,
      title: req.body.title,
      uuid: req.body.uuid,
      _attachments: {
        image: {
          content_type: imgtype,
          data: img64
        }
      }
    };
    if( image_rev ){
      params._rev = image_rev;
    }
    db.insert( params, function( err, body, header ){
      if( err ){
        console.log( err );
        var p = JSON.stringify( { status: false, error: err }, null, 2 );
        res.status( 400 );
        res.write( p );
        res.end();
      }else{
        var p = JSON.stringify( { status: true, id: image_id, body: body }, null, 2 );
        res.write( p );
        res.end();
      }
      fs.unlink( imgpath, function( err ){} );
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

app.get( '/attachment/:id', function( req, res ){
  if( db ){
    var image_id = req.params.id;
    db.attachment.get( image_id, 'image', function( err1, body1 ){
      res.contentType( 'image/png' );
      res.end( body1, 'binary' );
    });
  }else{
    res.contentType( 'application/json; charset=utf-8' );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

app.get( '/image/:id', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var image_id = req.params.id;
    db.get( id, null, function( err, body, header ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: err } ) );
        res.end();
      }else{
        res.write( JSON.stringify( { status: true, image: body } ) );
        res.end();
      }
    });
  }else{
    res.contentType( 'application/json; charset=utf-8' );
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});

app.delete( '/image/:id', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var id = req.params.id;

    //. Cloudant から削除
    db.get( id, null, function( err1, body1, header1 ){
      if( err1 ){
        err1.image_id = "error-1";
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: err1 } ) );
        res.end();
      }

      var rev = body1._rev;
      db.destroy( id, rev, function( err2, body2, header2 ){
        if( err2 ){
          err2.image_id = "error-2";
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err2 } ) );
          res.end();
        }

        body2.image_id = id;
        res.write( JSON.stringify( { status: true, body: body2 } ) );
        res.end();
      });
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'db is not initialized.' } ) );
    res.end();
  }
});


app.get( '/images', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;

  if( db ){
    db.list( { include_docs: true }, function( err, body ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        var total = body.total_rows;
        var images = [];
        body.rows.forEach( function( doc ){
          var _doc = JSON.parse(JSON.stringify(doc.doc));
          if( _doc._id.indexOf( '_' ) !== 0 && _doc.type && _doc.type == 'image' ){
            images.push( _doc );
          }
        });

        images.sort( sortByTimestampRev );

        if( offset || limit ){
          if( offset + limit > total ){
            images = images.slice( offset );
          }else{
            images = images.slice( offset, offset + limit );
          }
        }

        var result = { status: true, total: total, limit: limit, offset: offset, images: images };
        res.write( JSON.stringify( result, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

app.get( '/search/:uuid', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var offset = req.query.offset ? parseInt( req.query.offset ) : 0;
  var uuid = req.params.uuid;

  if( db ){
    db.find( { selector: { uuid: { "$eq": uuid } }, /*limit: 200,*/ fields: [ "_id", "_rev", "filename", "type", "title", "timestamp", "uuid" ] }, function( err, result ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
        res.end();
      }else{
        var total = result.docs.length;
        var images = [];
        result.docs.forEach( function( doc ){
          if( doc._id.indexOf( '_' ) !== 0 && doc.type && doc.type == 'image' ){
            images.push( doc );
          }
        });

        images.sort( sortByTimestampRev );

        if( offset || limit ){
          if( offset + limit > total ){
            images = images.slice( offset );
          }else{
            images = images.slice( offset, offset + limit );
          }
        }

        var result = { status: true, total: total, limit: limit, offset: offset, images: images };
        res.write( JSON.stringify( result, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

//. feature extension for #3
app.post( '/migrate_from', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var from_uuid = req.body.from_uuid;
    var to_uuid = req.body.to_uuid;
    if( from_uuid && to_uuid ){
      db.find( { selector: { uuid: { "$eq": from_uuid } }, fields: [ "_id", "_rev", "filename", "type", "title", "timestamp", "uuid", "_attachments" ] }, function( err, result ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
          res.end();
        }else{
          var images = [];
          result.docs.forEach( function( doc ){
            if( doc._id.indexOf( '_' ) !== 0 && doc.type && doc.type == 'image' ){
              doc.migrate_to = to_uuid;
              images.push( doc );
            }
          });

          db.bulk( { docs: images }, function( err, result ){
            if( err ){
              res.status( 400 );
              res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
              res.end();
            }else{
              res.write( JSON.stringify( { status: true, num: images.length }, 2, null ) );
              res.end();
            }
          });
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, message: 'uuid is not specified' }, 2, null ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

app.post( '/migrate_to', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    var from_uuid = req.body.from_uuid;
    var to_uuid = req.body.to_uuid;
    if( from_uuid && to_uuid ){
      db.find( { selector: { uuid: { "$eq": from_uuid } }, fields: [ "_id", "_rev", "filename", "type", "title", "timestamp", "uuid", "migrate_to", "_attachments" ] }, function( err, result ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
          res.end();
        }else{
          var images = [];
          result.docs.forEach( function( doc ){
            if( doc._id.indexOf( '_' ) !== 0 && doc.type && doc.type == 'image' && doc.migrate_to && doc.migrate_to == to_uuid ){
              delete doc.migrate_to;
              doc.uuid = to_uuid;
              images.push( doc );
            }
          });

          db.bulk( { docs: images }, function( err, result ){
            if( err ){
              res.status( 400 );
              res.write( JSON.stringify( { status: false, message: err }, 2, null ) );
              res.end();
            }else{
              res.write( JSON.stringify( { status: true, num: images.length }, 2, null ) );
              res.end();
            }
          });
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, message: 'uuid is not specified' }, 2, null ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'db is failed to initialize.' }, 2, null ) );
    res.end();
  }
});

//. #9
app.post( '/setcookie', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var value = req.body.value;
  //console.log( 'value = ' + value );
  res.setHeader( 'Set-Cookie', value );

  res.write( JSON.stringify( { status: true }, 2, null ) );
  res.end();
});


function insertQueryIndex(){
  if( db ){
    //. query index
    var query_index_owner = {
      _id: "_design/library",
      language: "query",
      indexes: {
        "uuid-index": {
          index: {
            fields: [ { name: "uuid", type: "string" } ]
          },
          type: "text"
        }
      }
    };
    db.insert( query_index_owner, function( err, body ){} );
  }
}

function timestamp2datetime( ts ){
  if( ts ){
    var dt = new Date( ts );
    var yyyy = dt.getFullYear();
    var mm = dt.getMonth() + 1;
    var dd = dt.getDate();
    var hh = dt.getHours();
    var nn = dt.getMinutes();
    var ss = dt.getSeconds();
    var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
      + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
    return datetime;
  }else{
    return "";
  }
}

function sortByTimestamp( a, b ){
  var r = 0;
  if( a.timestamp < b.timestamp ){
    r = -1;
  }else if( a.timestamp > b.timestamp ){
    r = 1;
  }

  return r;
}

function sortByTimestampRev( a, b ){
  var r = 0;
  if( a.timestamp < b.timestamp ){
    r = 1;
  }else if( a.timestamp > b.timestamp ){
    r = -1;
  }

  return r;
}


var port = process.env.PORT || 8080;
app.listen( port );
console.log( "server starting on " + port + " ..." );
console.log( "DB: " + db_url + ' (' + settings.db_password + ')' );
