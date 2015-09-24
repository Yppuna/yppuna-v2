var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var passport = require('passport');

var app = express();

var session = require('express-session');
var RedisStore = require('connect-redis')(session);
var LocalStrategy = require('passport-local').Strategy;
var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/dailyboom');
var User = require('./models/user');
//var materialize = require('materialize-css');

var routes = require('./routes/index');
var users = require('./routes/users');
var products = require('./routes/products');
var orders = require('./routes/orders');

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'vash');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser('keyboard cat'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({ secret: 'keyboard cat', name: 'session_id', saveUninitialized: true, resave: true })); // store: new RedisStore({ host: '127.0.0.1',  port: 6379 }),
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(passport.initialize());
app.use(passport.session());

app.use('/', routes);
app.use('/', users);
app.use('/', products);
app.use('/', orders);

passport.use(new LocalStrategy(
  function (username, password, done) {
    User.findOne({ username: username }, function (err, user) {
      console.log(username + '/' + password);
      if (err) { return done(err); }
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }
      user.comparePassword(password, function(err, isMatch) {
        console.log(isMatch);
        if (err) { return done(err); }
        if (isMatch === false) {
          return done(null, false, { message: 'Incorrect password.' });
        }
        else {
          return done(null, user);
        }
      });
    });
  }
));

passport.serializeUser(function(user, done) {
  console.log("serialize User: " + user);
  done(null, user._id);
});
 
passport.deserializeUser(function(id, done) {
  console.log("deserialize User: ");
  User.findById(id, function(err, user) {
    console.log(user);
    done(err, user);
  });
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});


module.exports = app;
