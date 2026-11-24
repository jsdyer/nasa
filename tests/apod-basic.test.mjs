import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../web/model.mjs';
const article = 'https://science.nasa.gov/image-article/apod-2026-november-24-test/';
const entry = extra => ({date:'2026-11-24',title:'A galaxy',url:article,permalink:article,media_type:'image',explanation:'<strong>Explanation:</strong> Stars &amp; dust',...extra});
test('APOD Basic keeps article and image separate, and hdurl is optional', () => {
  const [a] = M.normalizeApodBasic([entry({hdurl:'https://assets.science.nasa.gov/galaxy.jpg?w=100&#038;h=200'})]);
  assert.equal(a.page_url,article);assert.equal(a.url,'https://assets.science.nasa.gov/galaxy.jpg?w=100&h=200');assert.equal(a.explanation,'Stars & dust');assert.equal(M.isPlaceholderApod(a),false);
  const [b] = M.normalizeApodBasic([entry({basic_html:'<img src="https://assets.science.nasa.gov/galaxy.jpg">'})]);
  assert.equal(b.hdurl,null);assert.equal(b.media_type,'image');
  const [c] = M.normalizeApodBasic([entry({})]);assert.equal(c.media_type,'other');assert.equal(c.url,article);
});
test('direct video and protocol-relative iframe stay videos even with a poster image', () => {
  const poster='https://assets.science.nasa.gov/poster.jpg';
  const [a,b] = M.normalizeApodBasic([
    entry({media_type:'video',hdurl:poster,basic_html:'<video controls><source src="https://assets.science.nasa.gov/movie.mp4" type="video/mp4"></video>'}),
    entry({media_type:'iframe',hdurl:poster,basic_html:'<iframe src="//www.youtube.com/embed/DzrCEm1ZBRY?rel=0"></iframe>'})]);
  assert.equal(a.media_type,'video');assert.equal(a.url,'https://assets.science.nasa.gov/movie.mp4');assert.equal(a.thumbnail_url,poster);assert.equal(a.hdurl,null);
  assert.equal(b.media_type,'video');assert.equal(b.url,'https://www.youtube.com/embed/DzrCEm1ZBRY?rel=0');
});
test('invalid article/media addresses cannot become executable page content', () => {
  assert.deepEqual(M.normalizeApodBasic([entry({url:'javascript:alert(1)',permalink:'javascript:alert(1)'})]),[]);
  const [a] = M.normalizeApodBasic([entry({hdurl:'javascript:alert(1)',basic_html:'<img src="javascript:alert(1)">'})]);
  assert.equal(a.media_type,'other');assert.equal(a.url,article);
  assert.equal(M.isPlaceholderApod({title:'NASA Science',url:'https://science.nasa.gov/image-article/test/'}),true);
});
