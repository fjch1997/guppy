for x in `find ./ -type d | sed 's/\.\///'|grep -v '^$'`; do echo "<html><body><pre>" > $x/${x}_src.html; cat $x/$x.html | sed 's/</\&lt;/g;s/>/\&gt;/g' >> $x/${x}_src.html; echo "</pre></body></html>" >> $x/${x}_src.html; done