/**
 * Module dependencies.
 */

var express = require('express')
, routes = require('./routes')
, login = require('./routes/login.js')
, fileServe = require('./routes/fileServe.js')
, resize = require('./lib/resize.js')
, notify_users = require('./lib/notify_users.js')
, view_helpers = require('./lib/view_helpers.js')
, services = require('./lib/services.js')
, cf_utils = require('./lib/cloudFoundryUtil.js')
, RedisStore = require('connect-redis')(express)
, ejs = require('ejs')
;

var app = module.exports = express.createServer();

var broadcast = require('./lib/broadcast')();
broadcast.installHandlers(app, {
    prefix: '/broadcast',
    sockjs_url: '/javascripts/sockjs-0.3.js'
});

app.helpers({
    usernamelink: view_helpers.usernamelink,
    loggedin: view_helpers.loggedin,
    getLoggedinUser: view_helpers.getLoggedinUser
});

app.dynamicHelpers({
    ejs: function(req, res) {
        return ejs;
    },

    session: function(req, res){
        return req.session;
    },

    cf_instance: function(req, res) {
        return cf_utils.getInstanceId();
    }
});

// Configuration

app.configure(
    function() {
        app.set('views', __dirname + '/views');
        app.set('view engine', 'ejs');
        app.set('view options', {
            layout: true
        });
        app.use(express.static(__dirname + '/public'));
        app.use(express.bodyParser({
            uploadDir: __dirname + '/uploads',
            keepExtensions: true
        }));
        app.use(express.cookieParser());
        app.use(express.session({
            secret: "cloudstagram secret sauce", //TODO use an env variable here
            store: new RedisStore({
                client: services.getRedisClient()
            }),
            key: 'thejsessionid'
        }));
        app.use(express.methodOverride());
        app.use(app.router);
    }
);

app.configure('development', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
    app.use(express.errorHandler());
});

function restrict(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        req.session.error = 'Access denied!';
        res.redirect('/login');
    }
}

function loggedoutOnly(req, res, next) {
    if(req.session.user) {
        res.redirect('/');
    } else {
        next();
    }
}

// Routes
app.get('/', routes.index);
app.get('/image/:id', fileServe.serveFile);
app.get('/profile/:userid', routes.userProfile);
app.get('/latest', routes.latestImages);

//TODO add security, probably via an admin page.
app.post('/delete/image/:imageid', routes.deleteImage);

// Logged out only routes
app.post('/register', loggedoutOnly, login.addUser);
app.post('/login', loggedoutOnly, login.auth);

// Secure routes
app.post('/upload', restrict, routes.upload);
app.get('/logout', restrict, login.logout);
app.post('/like/:imageid', restrict, routes.likeImage);
app.get('/isfollower/:userid', restrict, routes.isFollower);
app.post('/follow/:userid', restrict, routes.followUser);

app.get('*', function(req, res){
  res.send(404);
});

services.getMongoDbConnection(function(err, db) {
    if (db) {
        services.getRabbitMqConnection(function(conn) {
            if (conn) {
                notify_users.startConsumers(broadcast);
                resize.startConsumers();
                app.listen(process.env.VCAP_APP_PORT || 3000, function(){
                    console.log("Express server listening on port %d in %s mode", 
                                app.address().port, 
                                app.settings.env);
                })
            } else {
                console.log("failed to connect to rabbitmq");
            }
        });
    } else {
        console.log("failed to connect to mongodb");
    }
});