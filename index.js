'use strict';

const fs = require('fs-extra');
const walk = require('fs-walk');
const rimraf = require('rimraf');
const plist = require('simple-plist');
const colors = require('colors/safe');
const execFile = require('child_process').execFile;

colors.setTheme({
	error: 'red',
	warn: 'green',
	msg: 'yellow'
});

const BIG = colors.msg;
const MSG = colors.warn;
const ERR = colors.error;

var codesign = {};

function log() {
	var args = [];
	for (var a of arguments) {
		args.push (a);
	}
	if (typeof arguments[0] == 'function') {
		console.log(arguments[0](args.slice(1).join(' ').trim()));
	} else {
		console.error(colors.error('[ERROR] ' + args.join(' ').trim()));
	}
}

function getResignedFilename(path) {
	const newPath = path.replace('.ipa', '-resigned.ipa');
	const pos = newPath.lastIndexOf('/');
	if (pos != -1) return newPath.substring(pos + 1);
	return newPath;
}

codesign.withConfig = function (options) {
	if (!options || !options.file) {
		err('No file specified');
		return false;
	}
	var config = { file: options.file };
	config.outdir = options.outdir || options.file + '.d';
	config.outfile = options.outfile || getResignedFilename(config.file);
	config.zip = options.zip || '/usr/bin/zip';
	config.unzip = options.unzip || '/usr/bin/unzip';
	config.codesign = options.codesign || '/usr/bin/codesign';
	config.security = options.codesign || '/usr/bin/security';
	config.entitlement = options.entitlement || undefined;
	config.bundleid = options.bundleid || undefined;
	config.identity = options.identity || undefined;
	config.mobileprovision = options.mobileprovision || undefined;
	return config;
}

function unzip(file, config, cb) {
	if (!file || !config.outdir) {
		err('No output specified');
		return false;
	}
	const args = [ '-o', file, '-d', config.outdir ];
	if (!config.outdir) {
		err('Invalid output directory');
		return false;
	}
	log(BIG, ['[$] rimraf', config.outdir].join(' '));
	rimraf(config.outdir, function() {
		log(BIG, '[$] ' + config.unzip + ' ' + args.join(' '));
		execFile (config.unzip, args, (rc, out, err) => {
			if (rc) {
				/* remove outdir created by unzip */
				rimraf(config.outdir, function() {
					cb (rc, out, err);
				});
			} else {
				cb (rc, out, err);
			}
		});
	});
}

codesign.fixPlist = function(file, config, cb) {
	if (!file || !config.bundleid || !config.appdir) {
		log (MSG, '[-] Skip bundle-id');
		return cb (false);
	}
	const pl_path = [config.appdir, file].join ('/');
	console.log(pl_path);
	const data = plist.readFileSync(pl_path);
	const oldBundleID = data['CFBundleIdentifier'];
	/* fix bundle-id */
	//console.log(data);
	log (MSG, 'CFBundleResourceSpecification:', data['CFBundleResourceSpecification']);
	log (MSG, 'Old BundleID:', oldBundleID);
	log (MSG, 'New BundleID:', config.bundleid);
	data['CFBundleIdentifier'] = config.bundleid;
	plist.writeFileSync(pl_path, data);
	cb (false, '');
}

codesign.checkProvision = function(file, config, cb) {
	if (!file || !config.appdir) {
		return cb (false);
	}
	const provision = 'embedded.mobileprovision';
	const pl_path = [ config.appdir, provision ].join ('/');
	fs.copy (file, pl_path, function (err) {
/*
// TODO: verify is mobileprovision app-id glob string matches the bundleid
// read provision file in raw
// search for application-identifier and <string>...</string>
// check if prefix matches and last dot separated word is an asterisk
// const identifierInProvisioning = 'x'
// Read the one in Info.plist and compare with bundleid
*/
		cb (err, err);
	});
}

codesign.fixEntitlements = function(file, config, cb) {
	log(BIG, '[*] Generating entitlements');
	if (!config.security || !config.mobileprovision) {
		return cb (false);
	}
	const args = ['cms', '-D', '-i', config.mobileprovision]
	execFile (config.security, args, (error, stdout, stderr) => {
		const data = plist.parse(stdout);
		const newEntitlements = data['Entitlements'];
		console.log(newEntitlements);
		/* save new entitlements */
		const provision = 'embedded.mobileprovision';
		const pl_path = [ config.appdir, provision ].join ('/');
		config.entitlement = pl_path;
		plist.writeFileSync(pl_path, newEntitlements);
		// log(MSG, stdout + stderr);
		cb (error, stdout || stderr);
	});
}

codesign.signFile = function(file, config, cb) {
	const args = [ '--no-strict' ]; // http://stackoverflow.com/a/26204757
	if (config.identity !== undefined) {
		args.push ('-fs', config.identity);
	} else {
		cb (true, '--identity is required to sign');
	}
	if (config.entitlement !== undefined) {
		args.push ('--entitlements=' + config.entitlement);
	}
	log(BIG, '[-] Sign', file);
	args.push (file);
	execFile (config.codesign, args, function (error, stdout, stderr) {
		const args = ['-v', file];
		log(BIG, '[-] Verify', file);
		execFile (config.codesign, args, function (error, stdout, stderr) {
			cb (error, stdout || stderr);
		});
	});
}

codesign.signLibraries = function(path, config, cb) {
	var signs = 0;
	function signDone() {
		signs--;
		if (signs == 0) {
			log(MSG, "Everything is signed now");
			cb (false);
		}
	}
	log(MSG, 'Signing libraries and frameworks');
	walk.walkSync(path, function(basedir, filename, stat, next) {
		const file = [ basedir, filename ].join('/');
		if (!fs.lstatSync(file).isFile()) {
			return;
		}
		try {
			const fd = fs.openSync (file, 'r');
			var buffer = new Buffer (4);
			fs.readSync (fd, buffer, 0, 4);
			if (!buffer.compare (Buffer([0xca, 0xfe, 0xba, 0xbe]))) {
				signs++;
				codesign.signFile (file, config, signDone);
			}
			fs.close(fd);
		} catch (e) {
			console.error(basedir, filename, e);
		}
	});
}

codesign.signAppDirectory = function(path, config, cb) {
	if (cb === undefined && typeof config === 'function') {
		cb = config;
		config = {};
	}
	try {
		if (!fs.lstatSync(config.outdir + '/Payload').isDirectory()) {
			throw 'Invalid IPA';
		}
	} catch (e) {
		return codesign.cleanup(config, () => {
			cb(true, 'Invalid IPA');
		});
	}
	log(BIG, '[*] Payload found');
	const files = fs.readdirSync(config.outdir + '/Payload').filter((x) => {
		return x.indexOf('.app') != -1;
	});
	if (files.length != 1) {
		return cb (true, 'Invalid IPA');
	}
	const binname = files[0].replace('.app','');
	config.appdir = [ config.outdir, 'Payload', files[0] ].join('/');
	const binpath = [ config.appdir, binname ].join('/');
	/* Warning: xmas tree ahead */
	if (fs.lstatSync(binpath).isFile()) {
		codesign.fixPlist ('Info.plist', config, (err, msg) => {
			codesign.checkProvision (config.mobileprovision, config, (err) => {
				codesign.fixEntitlements (binpath, config, (err) => {
					codesign.signFile (binpath, config, (err, reason) => {
						if (err) return cb (err, reason);
						codesign.signLibraries (config.appdir, config, cb);
					});
				});
			});
		});
	} else {
		cb (true, 'Invalid path');
	}
}

function relativeUpperDirectory(file) {
	return ((file[0] !== '/')? '../': '') + file;
}

codesign.cleanup = function (config, cb) {
	rimraf (config.outdir, cb);
}

codesign.ipafyDirectory = function (config, cb) {
	const zipfile = relativeUpperDirectory(config.outfile);
	const args = [ '-qry', zipfile, 'Payload' ];
	execFile (config.zip, args, { cwd:config.outdir }, (error, stdout, stderr) => {
		cb(error, stdout || stderr);
	});
}

codesign.getIdentities = function(config, cb) {
	const zipfile = relativeUpperDirectory(config.outfile);
	const args = [ 'find-identity', '-v', '-p', 'codesigning' ];
	execFile (config.security, args, (error, stdout, stderr) => {
		if (error) {
			cb (error, stderr);
		} else {
			var lines = stdout.split('\n');
			lines.pop(); // remove last line
			var ids = []
			for (var line of lines) {
				const tok = line.indexOf(') ');
				if (tok != -1) {
					line = line.substring(tok+2).trim();
					const tok2 = line.indexOf(' ');
					if (tok2 != -1) {
						ids.push ({
							hash: line.substring(0, tok2),
							name: line.substring(tok2+1)
						});
					}
				}
			}
			cb (false, ids);
		}
	});
}

codesign.signIPA = function(config, cb) {
	rimraf (config.outdir, () => {
		unzip (config.file, config, (error, stdout, stderr) => {
			if (error) {
				return cb (error, stderr);
			}
			codesign.signAppDirectory (config.outdir, config, (error, res) => {
				if (error) {
					return cb (error, res);
				}
				codesign.ipafyDirectory (config, (error, res) => {
					if (error) {
						msg(ERR, res);
					}
					codesign.cleanup (config, () => {
						log(BIG, '[-] Removing temporary directory');
						cb (error, res);
					});
				});
			});
		});
	});
}

module.exports = function(options) {
	const self = this;
	this.config = codesign.withConfig (options);
	this.signIPA = function (cb) {
		codesign.signIPA (self.config, cb);
	}
	this.cleanup = function (cb) {
		codesign.cleanup (self.config, cb);
	}
	this.getIdentities = function (cb) {
		codesign.getIdentities (self.config, cb);
	}
	this.logError = log;
}
