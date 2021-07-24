exports.db_username = 'apikey-v2-1x5jnfxxfistm69mbrafefhlkfqeo1ia8goqafyglpqr';
exports.db_password = 'd0844ed0a8e528fe895405926db417b7';
exports.db_url = 'https://662eea0e-ddf5-48e9-9026-719f6d2f570a-bluemix.cloudantnosqldb.appdomain.cloud/';
exports.db_name = 't2020';

exports.admin_username = 'username';
exports.admin_password = 'password';

if( process.env.VCAP_SERVICES ){
  var VCAP_SERVICES = JSON.parse( process.env.VCAP_SERVICES );
  if( VCAP_SERVICES && VCAP_SERVICES.cloudantNoSQLDB ){
    exports.db_username = VCAP_SERVICES.cloudantNoSQLDB[0].credentials.username;
    exports.db_password = VCAP_SERVICES.cloudantNoSQLDB[0].credentials.password;
  }
}
